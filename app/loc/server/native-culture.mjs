// Fixed-purpose public Culture operations in the existing LOC Pages runtime.
// No arbitrary SQL, caller-selected relation, database alias, or Gateway.
import {SCOPE_ROUTE_INDEX} from '../../modular/scope-route-index.js';
import {directMcpKysely} from '../mcp/native-kysely.mjs';

const HEADERS={'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store','x-content-type-options':'nosniff'};
const respond=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:HEADERS});
const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value);
const published=id=>SCOPE_ROUTE_INDEX.some(row=>row.scope_id===id&&row.active!==false);
const day=value=>value instanceof Date?value.toISOString().slice(0,10):String(value||'').slice(0,10);
export async function handleNativeCulture(request,env={},database=directMcpKysely){
  if(request.method!=='GET')return respond({error:'GET required'},405);
  const params=new URL(request.url).searchParams;
  const view=String(params.get('view')||'');
  const scope=String(params.get('scope')||'');
  const start=String(params.get('start')||'');
  const end=String(params.get('end')||'');
  const allowed=new Set(['view','scope','start','end','site','offset']);
  if([...params.keys()].some(key=>!allowed.has(key))||
    !['culture_anchors','culture_density','culture_list'].includes(view)||
    !/^[a-z][a-z0-9]{0,14}$/.test(scope)||!published(scope)||
    (view==='culture_anchors'&&(start||end||params.has('site')||params.has('offset')))||
    (view!=='culture_anchors'&&(!validDate(start)||!validDate(end)||start>end))||
    (view!=='culture_list'&&(params.has('site')||params.has('offset'))))
    return respond({error:'Invalid LOC Culture request'},400);
  const site=String(params.get('site')||'');
  const offset=Number(params.get('offset')||0);
  if(view==='culture_list'&&(!site||site.length>120||!Number.isSafeInteger(offset)||
    offset<0||offset>100000))return respond({error:'Invalid LOC Culture list'},400);
  try{
    const alias=String(env.LOC_PUBLIC_DB_ALIAS||env.LOC_CONTROL_DB_ALIAS||env.LOC_MCP_DB_ALIAS||'');
    const {db,engine}=await database(env,alias);
    if(!db||engine!=='postgres')return respond({error:'LOC native database unavailable'},503);
    if(view==='culture_anchors'){
      const rows=await db.selectFrom('silver.'+scope+'_anchor')
        .select(['uid','type','title','attr'])
        .where('type','in',['date','period','era'])
        .where('invisible','=',false).limit(5000).execute();
      return respond({data:rows});
    }
    if(view==='culture_density'){
      const rows=await db.selectFrom('silver.'+scope+'_galaxy')
        .select(['date','site']).select(eb=>eb.fn.countAll().as('item_count'))
        .where('culture','=',true).where('date','>=',start)
        .where('date','<=',end).where('date','is not',null)
        .groupBy(['date','site']).orderBy('date','asc').execute();
      return respond({data:rows.map(row=>({day:day(row.date),
        site:String(row.site||''),item_count:Number(row.item_count||0)}))});
    }
    const rows=await db.selectFrom('silver.'+scope+'_galaxy')
      .select(['uid','date','title','list'])
      .where('date','>=',start).where('date','<=',end)
      .where('site','=',site).where('culture','=',true)
      .orderBy('createtime','desc').limit(100).offset(offset).execute();
    return respond({data:{rows:rows.map(row=>row.list===false
      ?{hidden:true,title:'本文已隱藏',list:false}
      :{uid:String(row.uid),date:day(row.date),title:String(row.title||''),
        list:true,hidden:false}),hasMore:rows.length===100,
      nextCursor:rows.length===100?{offset:offset+rows.length}:null}});
  }catch(error){
    console.error('[LOC Culture] native database query failed',error?.code||'UNKNOWN');
    return respond({error:'LOC native database unavailable'},503);
  }
}
