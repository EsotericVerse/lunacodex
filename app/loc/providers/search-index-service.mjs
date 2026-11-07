import {locGlobalUid} from '../../../zenstack/global-identity.mjs';
import {parsePortableOrExpression} from './portable-search.mjs';

// Private LOC index transport. Works with any SQL target; the index is a
// candidate filter only, NEVER a source of article content or authorization.
// Missing or incomplete indexes leave existing Kysely SQL search unchanged.
const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const SOURCE=/^[a-z][a-z0-9_-]{0,63}$/;
const UID=/^[A-Za-z0-9]{8}$/;

function service(){
  const address=String(Deno.env.get('LOC_SEARCH_INDEX_URL')||'').trim();
  const secret=String(Deno.env.get('LOC_SEARCH_INDEX_SECRET')||'');
  if(!address||secret.length<32)return null;
  let url;try{url=new URL(address);}catch{return null;}
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||
     !['','/'].includes(url.pathname))return null;
  return {url:url.origin,secret};
}
async function requestIndex(path,method,body){
  const options=service();
  if(!options)return null;
  try{
    const response=await fetch(options.url+path,{
      method,headers:{'content-type':'application/json',
        authorization:'Bearer '+options.secret},
      body:JSON.stringify(body),redirect:'error',
      signal:AbortSignal.timeout(1800)
    });
    if(!response.ok)throw new Error('LOC Index HTTP '+response.status);
    return await response.json();
  }catch(error){
    // Failure must fall back to SQL. No client credential, UID or text returned.
    console.warn('[loc-search-index] Search index unavailable:',String(error));
    return null;
  }
}
function targetId(target){
  const id=String(target?.dataset_id||target?.connection_alias||target?.target_id||'');
  return SOURCE.test(id)?id:null;
}
// Index hints are client-provided optimization requests, not SQL predicates.
// A UID prefilter is safe only if every possible SQL result is known to
// contain that exact literal term. A different term or an OR expression
// would silently omit valid Galaxy articles even when SQL permissions pass.
function hasRequiredContentTerm(body,term){
  const filters=Array.isArray(body?.filters)?body.filters:[];
  if(filters.some(f=>f?.column==='content'&&f.operator==='contains'&&
    f.negate!==true&&f.value===term))return true;
  const or=Array.isArray(body?.or)?body.or:[];
  if(or.length!==1)return false;
  let parsed;
  try{parsed=parsePortableOrExpression(or[0]);}catch{return false;}
  return parsed.type==='or'&&parsed.items.length===1&&
    parsed.items[0].type==='predicate'&&
    parsed.items[0].column==='content'&&
    parsed.items[0].operator==='contains'&&parsed.items[0].value===term;
}
// Exact ordinary content term only. Boolean expressions, quoted phrases,
// browsing, excluded terms and UID lookups keep the existing SQL semantics.
// Scope/DB identity is checked again on the response and SQL applies its
// original content/date/site/publication/authorization predicates.
export async function withIndexedCandidates(body,target){
  // Never narrow a live SQL query until its index has been built and the
  // deployment explicitly opts in. KV is eventually consistent.
  if(String(Deno.env.get('LOC_SEARCH_INDEX_ENABLED')||'').toLowerCase()!=='true')
    return body;
  if(body?.kind!=='query'||body.operation!=='select'||body.schema!=='silver'||
     typeof body.table!=='string'||!body.table.endsWith('_galaxy'))return body;
  const scopeId=body.table.slice(0,-'_galaxy'.length);
  const hint=body.indexHint;
  const q=String(hint?.query||'').trim();
  const dbId=targetId(target);
  if(!SCOPE.test(scopeId)||hint?.scopeId!==scopeId||!dbId||
     q.length<2||q.length>100||!/^[\p{L}\p{N}]+$/u.test(q)||
     !hasRequiredContentTerm(body,q))return body;
  const result=await requestIndex('/v1/search','POST',{
    scopeId,dbId,entityType:'galaxy',query:q
  });
  if(result?.complete!==true||!Array.isArray(result.hits)||
     result.hits.length>200)return body;
  const ids=[];
  for(const hit of result.hits){
    if(hit?.scopeId!==scopeId||hit?.dbId!==dbId||
       hit.entityType!=='galaxy'||!UID.test(hit.uid))return body;
    // The authoritative ZModel virtual federation contract (PR #1219).
    // A stale or incorrectly qualified index hit must never route by UID alone.
    const globalUid=locGlobalUid({databaseId:dbId,scopeId,uid:hit.uid});
    if(hit.globalUid!==globalUid)return body;
    ids.push(hit.uid);
  }
  // Empty candidate sets and temporary KV propagation gaps retain the SQL
  // path. The search index must not hide newly committed SQL documents.
  if(!ids.length)return body;
  return {...body,filters:[...(Array.isArray(body.filters)?body.filters:[]),
    {column:'uid',operator:'in',value:[...new Set(ids)]}]};
}
/**
 * One FlexSearch lookup for an authorized Scope spread over multiple SQL
 * targets. All dataset IDs originate in the trusted Gateway registry.
 * Partial, invalid, empty, stale or unavailable indexes fall back to each
 * source's original SQL predicate. Never trust index hits as permissions.
 */
export async function federatedIndexedCandidates(body,sources){
  if(String(Deno.env.get('LOC_SEARCH_INDEX_ENABLED')||'').toLowerCase()!=='true')
    return null;
  const scopeId=String(body?.indexHint?.scopeId||'');
  const query=String(body?.indexHint?.query||'').trim();
  if(!SCOPE.test(scopeId)||!Array.isArray(sources)||!sources.length||
     sources.length>12||query.length<2||query.length>100||
     !/^[\p{L}\p{N}]+$/u.test(query)||
     !hasRequiredContentTerm(body,query))return null;
  const dbIds=sources.map(source=>source?.databaseId);
  if(dbIds.some(id=>!SOURCE.test(id))||new Set(dbIds).size!==dbIds.length)return null;
  const response=await requestIndex('/v1/search','POST',{
    scopeId,dbIds,entityType:'galaxy',query
  });
  if(response?.complete!==true||!Array.isArray(response.hits)||
     response.hits.length>200||!response.hits.length)return null;
  const candidates=new Map(dbIds.map(id=>[id,new Set()]));
  for(const hit of response.hits){
    if(hit?.scopeId!==scopeId||!candidates.has(hit.dbId)||
       hit.entityType!=='galaxy'||!UID.test(hit.uid)||
       hit.globalUid!==locGlobalUid({
         databaseId:hit.dbId,scopeId,uid:hit.uid
       }))return null;
    candidates.get(hit.dbId).add(hit.uid);
  }
  return candidates;
}

// A trusted Gateway writes only to the private index Worker. An index failure
// never changes or rolls back a committed Galaxy write; index completeness
// must be managed separately by the backfill/cutover procedure.
export async function writeSearchIndexDocuments(documents){
  if(!Array.isArray(documents)||!documents.length)return false;
  const checked=documents.filter(d=>SCOPE.test(d?.scopeId)&&
    SOURCE.test(d?.dbId)&&UID.test(d?.uid)&&d.entityType==='galaxy'&&
    ['append','upsert','remove'].includes(d.operation)&&
    (d.operation==='remove'||typeof d.content==='string'));
  if(checked.length!==documents.length)return false;
  const r=await requestIndex('/v1/documents','POST',{documents:checked});
  return r?.accepted===true;
}
export function searchIndexDatabaseId(target){return targetId(target);}

export function isSearchIndexConfigured(){return Boolean(service());}
export function indexDocumentsFromWrite(body,target){
  const dbId=targetId(target);
  if(!dbId||!body||typeof body!=='object')return [];
  const managed=body.kind==='managed-write';
  if(!managed&&!(body.kind==='query'&&body.operation!=='select'))return [];
  const payload=managed?body.payload:body;
  const table=String((managed?payload?.p_table:payload?.table)||'')
    .replace(/^silver\./,'');
  const schema=managed?'silver':String(payload?.schema||'');
  if(schema!=='silver'||!table.endsWith('_galaxy'))return [];
  const scopeId=table.slice(0,-'_galaxy'.length);
  if(!SCOPE.test(scopeId))return [];
  const operation=String(managed?payload?.p_operation:payload?.operation);
  let rows=[];
  if(operation==='insert')
    rows=managed?payload?.p_rows:Array.isArray(payload?.values)?payload.values:[payload?.values];
  else if(operation==='update'||operation==='delete'){
    const filters=managed?payload?.p_filters:payload?.filters;
    if(!Array.isArray(filters)||filters.length!==1||
       filters[0]?.column!=='uid'||filters[0]?.operator!=='eq')return [];
    rows=[{uid:filters[0].value,
      ...(operation==='update'?(managed?payload.p_values:payload.values):{})}];
  }
  if(!Array.isArray(rows)||rows.length>50)return [];
  return rows.flatMap(row=>{
    if(!row||!UID.test(String(row.uid||'')))return [];
    if(operation==='delete')return [{
      scopeId,dbId,entityType:'galaxy',uid:row.uid,operation:'remove'
    }];
    if(typeof row.content!=='string')return [];
    return [{
      scopeId,dbId,entityType:'galaxy',uid:row.uid,
      content:row.content,operation:'upsert'
    }];
  });
}

/**
 * Compare live SQL page identities against the independent, *unfiltered* KV
 * candidate index. Shadow mode is an opt-in probe only: it never narrows the
 * SQL request or changes what the user sees. No articles, UIDs or query terms
 * are written to logs; only integer counts are returned to the Gateway.
 */
export async function shadowIndexCoverage(body,sources,rows){
  const result=(kind,checked=0,missing=0,indexed=0)=>
    ({kind,checked,missing,indexed});
  if(String(Deno.env.get('LOC_SEARCH_INDEX_SHADOW')||'').toLowerCase()!=='true'||
     String(Deno.env.get('LOC_SEARCH_INDEX_ENABLED')||'').toLowerCase()==='true')
    return result('disabled');
  const scopeId=String(body?.indexHint?.scopeId||'');
  const query=String(body?.indexHint?.query||'').trim();
  if(body?.kind!=='query'||body.operation!=='select'||body.schema!=='silver'||
     body.table!==scopeId+'_galaxy'||!SCOPE.test(scopeId)||
     !/^[\p{L}\p{N}]+$/u.test(query)||query.length<2||query.length>100||
     !hasRequiredContentTerm(body,query)||
     !Array.isArray(sources)||!sources.length||sources.length>12||
     !Array.isArray(rows)||!rows.length)return result('ineligible');
  const ids=sources.map(s=>s?.databaseId);
  if(ids.some(id=>!SOURCE.test(id))||new Set(ids).size!==ids.length)
    return result('ineligible');
  const seen=new Set();
  for(const row of rows){
    const dbId=String(row?.__db_id|| (ids.length===1?ids[0]:''));
    const uid=String(row?.uid||'');
    if(!ids.includes(dbId)||!UID.test(uid))return result('unavailable');
    seen.add(locGlobalUid({databaseId:dbId,scopeId,uid}));
  }
  const index=await requestIndex('/v1/search','POST',{
    scopeId,dbIds:ids,entityType:'galaxy',query
  });
  if(index?.complete!==true||!Array.isArray(index.hits)||
     index.hits.length>200)return result('unavailable');
  const candidates=new Set();
  for(const hit of index.hits){
    if(hit?.scopeId!==scopeId||!ids.includes(hit.dbId)||
       hit.entityType!=='galaxy'||!UID.test(hit.uid)||
       hit.globalUid!==locGlobalUid({databaseId:hit.dbId,scopeId,uid:hit.uid}))
      return result('unavailable');
    candidates.add(hit.globalUid);
  }
  let missing=0;
  for(const uid of seen)if(!candidates.has(uid))missing++;
  return result('compared',seen.size,missing,candidates.size);
}
