// Fixed public LOC business reads in the EXISTING Pages application runtime.
// Kysely talks to the database itself. No generic SQL endpoint, arbitrary
// table/column/operator input, connection URL, or browser-selected driver.
import {SCOPE_ROUTE_INDEX} from '../../modular/scope-route-index.js';
import {scopeConfigColumns} from '../scope-config-fields.mjs';
import {directMcpKysely} from '../mcp/native-kysely.mjs';

const FEATURES=new Set(['culture','statics','trace','search']);
const HEADERS={'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store','x-content-type-options':'nosniff'};
const BLOCK_FIELDS=['uid','page_name','block_eyebrow','block_title','block_subtitle',
  'block_text','block_order','block_entity','block_image'];
const respond=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:HEADERS});
const allowedScope=id=>SCOPE_ROUTE_INDEX.some(row=>row.scope_id===id&&row.active!==false);
const NUMERIC_KINDS=new Set(['culture_density','daily','overview','earliest','totals']);
const DAY=/^\d{4}-\d{2}-\d{2}$/;
const day=value=>value instanceof Date?value.toISOString().slice(0,10):String(value??'').slice(0,10);
const total=value=>Number(value)||0;

// A fixed, bounded Galaxy aggregation performed where the native connection
// already lives. Never download per-article rows to aggregate in a browser;
// never infer Galaxy.site from a Source Anchor display label.
async function readGalaxyNumeric(db,scope,kind,start,end){
  const table='silver.'+scope+'_galaxy';
  const isCulture=kind==='culture_density';
  if(kind==='earliest'){
    const first=await db.selectFrom(table).select(eb=>eb.fn.min('date').as('earliest'))
      .where('statics','=',true).where('date','is not',null).executeTakeFirst();
    return day(first?.earliest)||'';
  }
  if(kind==='totals'){
    const rows=await db.selectFrom(table).select('site')
      .select(eb=>eb.fn.countAll().as('item_count'))
      .where('statics','=',true)
      .where('date','>=',start).where('date','<=',end)
      .where('date','is not',null)
      .groupBy('site').orderBy('site','asc').limit(5001).execute();
    if(rows.length>5000)throw new Error('Too many Galaxy sources');
    return rows.map(row=>({kind:'source',category:String(row.site||''),
      item_count:total(row.item_count)}));
  }
  const q=db.selectFrom(table).select(['date','site'])
    .select(eb=>eb.fn.countAll().as('item_count'))
    .where(isCulture?'culture':'statics','=',true)
    .where('date','>=',start).where('date','<=',end)
    .where('date','is not',null)
    .groupBy(['date','site']).orderBy('date','asc').limit(5001);
  const [raw,first]=await Promise.all([
    q.execute(),
    kind==='overview'?db.selectFrom(table)
      .select(eb=>eb.fn.min('date').as('earliest'))
      .where('statics','=',true).where('date','is not',null)
      .executeTakeFirst():Promise.resolve(null)
  ]);
  if(raw.length>5000)throw new Error('Too many daily Galaxy groups');
  if(isCulture)return raw.map(row=>({day:day(row.date),
    site:String(row.site||''),item_count:total(row.item_count)}));
  // One grouped SQL query supplies both the Source and Total rows. It is not
  // necessary to query the Galaxy table again to count each calendar day.
  const totals=new Map(),rows=[];
  for(const row of raw){
    const date=day(row.date),count=total(row.item_count);
    rows.push({day:date,kind:'source',category:String(row.site||''),item_count:count});
    totals.set(date,(totals.get(date)||0)+count);
  }
  rows.push(...[...totals].map(([date,count])=>({
    day:date,kind:'total',category:'文字作品',item_count:count
  })));
  rows.sort((a,b)=>a.day.localeCompare(b.day)||a.kind.localeCompare(b.kind));
  return kind==='overview'?{earliest:day(first?.earliest)||'',rows,categories:[],aliases:[]}:rows;
}

export async function handleNativePublicContent(request,env={},{
  database=directMcpKysely
}={}){
  if(request.method!=='GET')return respond({error:'GET required'},405);
  const url=new URL(request.url);
  const kind=url.searchParams.get('kind');
  const scope=String(url.searchParams.get('scope')||'');
  const feature=String(url.searchParams.get('feature')||'');
  const keys=[...url.searchParams.keys()];
  const numeric=NUMERIC_KINDS.has(kind);
  const start=String(url.searchParams.get('start')||'');
  const end=String(url.searchParams.get('end')||'');
  if(!allowedScope(scope)||!['config','blocks','hero'].includes(kind)&&!numeric||
      keys.some(key=>!['kind','scope','feature','start','end'].includes(key))||
      (kind==='hero'?!FEATURES.has(feature):Boolean(feature))||
      (kind==='hero'&&!keys.includes('feature'))||
      (!numeric&&(url.searchParams.has('start')||url.searchParams.has('end')))||
      (numeric&&(scope==='loc'||(kind!=='earliest'&&
        (!DAY.test(start)||!DAY.test(end)||start>end))||
        (kind==='earliest'&&(start||end)))))
    return respond({error:'Invalid LOC public content request'},400);
  try{
    // Alias and credential are server-owned. An HTTP parameter must never
    // determine the engine, endpoint, connection profile or SQL relation.
    const alias=String(env.LOC_PUBLIC_DB_ALIAS||env.LOC_CONTROL_DB_ALIAS||
      env.LOC_MCP_DB_ALIAS||'');
    const port=await database(env,alias);
    if(!port?.db||port.engine!=='postgres')
      return respond({error:'LOC native database unavailable'},503);
    const query=port.db;
    if(numeric)return respond({data:await readGalaxyNumeric(query,scope,kind,start,end)});
    if(kind==='config'){
      const columns=scopeConfigColumns(scope).split(',').filter(Boolean);
      const row=await query.selectFrom('silver.'+scope)
        .select(columns).where('id','=',scope).limit(1).executeTakeFirst();
      return respond({data:row||null});
    }
    const table=kind==='hero'?'silver.loc_blocks':
      'silver.'+scope+'_blocks';
    const names=kind==='hero'?['group_'+feature,'scope_'+feature]:['index'];
    const data=await query.selectFrom(table).select(BLOCK_FIELDS)
      .where('page_name','in',names).orderBy('block_order','asc')
      .limit(100).execute();
    return respond({data});
  }catch(error){
    console.error('[LOC native public content] server database connection unavailable');
    return respond({error:'LOC native database unavailable'},503);
  }
}
