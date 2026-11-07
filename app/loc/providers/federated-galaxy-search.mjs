// LOC SQL Gateway's provider-neutral federated Galaxy reader.
// All source targets come from trusted server configuration, NEVER from a
// browser-supplied provider/SQL credential. No SQL DDL, migrations or RPCs.
import {normalizeDatabaseTarget} from './selected-database-target.mjs';
import {locGlobalUid} from '../../../zenstack/global-identity.mjs';
import {isTextSearchQuery} from './search-qos.mjs';

const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const ID=/^[a-z][a-z0-9_-]{0,63}$/;
const UID=/^[A-Za-z0-9]{8}$/;
const BATCH=40;
const MAX_DATASETS=12;
const MAX_WINDOW=2000;
function bad(message){throw Object.assign(new Error(message),{httpStatus:400});}

/**
 * LOC_SEARCH_DATASETS_JSON is optional and trusted. Example:
 * {"lo3rwang":[
 *   {"databaseId":"db1","provider":"supabase","engine":"postgres",
 *    "connection_alias":"supabase_current"},
 *   {"databaseId":"db2","provider":"custom","engine":"mysql",
 *    "connection_alias":"office_mysql"}
 * ]}
 * Database IDs are stable logical names, not provider names/URLs. Profiles
 * and passwords remain in the existing LOC_DB_CONNECTIONS_JSON secret.
 */
export function federatedDatasetsFor(raw,scopeId){
  if(!SCOPE.test(String(scopeId||'')))bad('Invalid federated Scope ID');
  if(!raw)return [];
  let configured;
  try{configured=JSON.parse(raw);}catch{bad('Invalid federated dataset registry JSON');}
  if(!configured||typeof configured!=='object'||Array.isArray(configured))
    bad('Invalid federated dataset registry');
  const rows=configured[scopeId];
  if(rows===undefined)return [];
  if(!Array.isArray(rows)||rows.length<1||rows.length>MAX_DATASETS)
    bad('Invalid federated dataset count');
  const ids=new Set(),aliases=new Set();
  return rows.map(entry=>{
    if(!entry||typeof entry!=='object'||Array.isArray(entry)||
       !ID.test(entry.databaseId))bad('Invalid federated logical database ID');
    // The selection flag and connection profile are server-owned. This
    // registry is the allowed list for this Scope; never trust request.dbIds.
    const target=normalizeDatabaseTarget({
      provider:entry.provider,engine:entry.engine,
      connection_alias:entry.connection_alias,
      connection_mode:entry.connection_mode||'direct',
      selected:true,dataset_id:entry.databaseId
    });
    if(ids.has(entry.databaseId)||aliases.has(target.connection_alias))
      bad('Duplicate federated source or logical database ID');
    ids.add(entry.databaseId);aliases.add(target.connection_alias);
    return Object.freeze({databaseId:entry.databaseId,target});
  });
}
export function federatedScopeFromQuery(body){
  if(body?.kind!=='query'||body.operation!=='select'||
     body.schema!=='silver'||typeof body.table!=='string')return '';
  const match=body.table.match(/^([a-z][a-z0-9]{0,14})_galaxy$/);
  return match?.[1]||'';
}
export function isFederatedTextSearch(body){
  const scopeId=federatedScopeFromQuery(body);
  return Boolean(scopeId&&body.indexHint?.scopeId===scopeId&&
    !body.head&&!body.count&&isTextSearchQuery(body)&&
    Array.isArray(body.columns)&&
    Array.isArray(body.orders)&&body.orders.length===1&&
    ['date','createtime'].includes(body.orders[0].column)&&
    body.columns.includes(body.orders[0].column)&&
    body.columns.includes('uid'));
}
export function isDatasetQualifiedArticleRead(body){
  if(!federatedScopeFromQuery(body)||body.head||body.count)return false;
  const ids=(Array.isArray(body.filters)?body.filters:[]).filter(filter=>
    filter?.column==='uid'&&!filter.negate&&
    (filter.operator==='eq'||filter.operator==='in'));
  return ids.length===1&&ids.every(({operator,value})=>
    operator==='eq'?UID.test(String(value||'')):
    Array.isArray(value)&&value.length>0&&value.length<=BATCH&&
      value.every(uid=>UID.test(String(uid||''))));
}
function sortable(value){
  if(value instanceof Date)return value.toISOString();
  return String(value??'');
}
/** Query each SQL data set by the same authorized Kysely SELECT.
 * Ordered k-way merge guarantees that one page can contain rows from
 * different DBs even when UIDs are identical. Pagination offset is global,
 * not per dataset. Never dedupe using the local UID.
 */
export async function mergeFederatedGalaxyRows(sources,request,readPage){
  if(!Array.isArray(sources)||sources.length<2||
     sources.length>MAX_DATASETS)bad('Invalid federated sources');
  if(!isFederatedTextSearch(request))bad('Unsupported federated Galaxy query');
  if(typeof readPage!=='function')bad('Missing federated SQL executor');
  const offset=Math.max(0,Math.floor(Number(request.offset)||0));
  const limit=Math.max(0,Math.floor(Number(request.limit)||0));
  if(!limit||offset+limit>MAX_WINDOW)bad('Federated Search page exceeds bounded global window');
  const column=request.orders[0].column;
  const ascending=request.orders[0].ascending!==false;
  const states=sources.map(source=>({
    source,offset:0,queue:[],position:0,exhausted:false
  }));
  const refill=async state=>{
    if(state.position<state.queue.length||state.exhausted)return;
    const rows=await readPage(state.source,{
      ...request,offset:state.offset,limit:BATCH,
      // Original text predicate, source/date and publication filters stay
      // attached to every per-dataset query. The index is only a candidate.
    });
    if(!Array.isArray(rows)||rows.length>BATCH)
      throw Error('Invalid bounded federated SQL page');
    state.offset+=rows.length;
    state.queue=rows;state.position=0;state.exhausted=rows.length<BATCH;
  };
  // A maximum of four simultaneous SQL calls; the Gateway's concurrency
  // budget should not fan out N uncontrolled database sessions.
  for(let i=0;i<states.length;i+=4)
    await Promise.all(states.slice(i,i+4).map(refill));
  const total=offset+limit,merged=[];
  for(let consumed=0;consumed<total;consumed++){
    let best=-1;
    for(let i=0;i<states.length;i++){
      const row=states[i].queue[states[i].position];
      if(!row)continue;
      if(best===-1){best=i;continue;}
      const other=states[best].queue[states[best].position];
      const a=sortable(row[column]),b=sortable(other[column]);
      // Never sort by opaque UID. Stable logical-source order resolves date
      // ties; within one source the original database order is preserved.
      const comp=a.localeCompare(b);
      if((ascending?comp:-comp)<0)best=i;
    }
    if(best===-1)break;
    const state=states[best],row=state.queue[state.position++];
    if(consumed>=offset){
      // The source identity is response-only metadata, not a SQL column.
      const databaseId=state.source.databaseId;
      if(!UID.test(String(row.uid||'')))
        throw Error('Federated SQL returned a non-Galaxy UID');
      merged.push({...row,__db_id:databaseId,
        __global_uid:locGlobalUid({databaseId,
          scopeId:federatedScopeFromQuery(request),uid:row.uid})});
    }
    await refill(state);
  }
  return {data:merged,count:null};
}
