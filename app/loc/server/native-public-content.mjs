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

export async function handleNativePublicContent(request,env={},{
  database=directMcpKysely
}={}){
  if(request.method!=='GET')return respond({error:'GET required'},405);
  const url=new URL(request.url);
  const kind=url.searchParams.get('kind');
  const scope=String(url.searchParams.get('scope')||'');
  const feature=String(url.searchParams.get('feature')||'');
  const keys=[...url.searchParams.keys()];
  if(!allowedScope(scope)||!['config','blocks','hero'].includes(kind)||
      keys.some(key=>!['kind','scope','feature'].includes(key))||
      (kind==='hero'?!FEATURES.has(feature):Boolean(feature))||
      (kind==='hero'&&!keys.includes('feature')))
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
    console.error('[LOC native public content]',String(error?.message||error));
    return respond({error:'LOC native database unavailable'},503);
  }
}
