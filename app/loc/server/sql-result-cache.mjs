// LOC public SQL result cache. Only fixed, server-authorized anonymous
// projections may use this module; never cache Auth, permissions or private reads.
//
// A revision must come from the SAME database as the Kysely SELECT. The
// PostgreSQL statement trigger is the authority, including writes from other
// processes. Missing revision support means an uncached, live SELECT.
const MAX_ENTRIES=80;
const MAX_RESULT_CHARS=350000;
const MAX_TOTAL_CHARS=2000000; // Bounded per-isolate memory, not 80 huge rows.
const MAX_AGE_MS=120000;
const RELATION=/^silver\.[a-z][a-z0-9]{0,14}(?:_galaxy|_anchor|_blocks)?$/;
const completed=new Map();
const pending=new Map();
let totalChars=0;

function dependencyNames(values){
  if(!Array.isArray(values)||!values.length)return null;
  const names=[...new Set(values)];
  if(names.length!==values.length||names.some(name=>typeof name!=='string'||
    !RELATION.test(name)||name==='silver.loc_blocks'))
    return null;
  return names.sort();
}

async function revisionsFor(db,names){
  const rows=await db.selectFrom('api.loc_sql_result_revision')
    .select(['relation','revision'])
    .where('relation','in',names).execute();
  const versions=new Map(rows.map(row=>[row.relation,String(row.revision)]));
  return versions.size===names.length&&names.every(name=>versions.has(name))
    ?names.map(name=>[name,versions.get(name)]):null;
}

function discard(key){
  const old=completed.get(key);
  if(old){totalChars-=old.json.length;completed.delete(key)}
}
function remember(key,json){
  discard(key);
  completed.set(key,{json,expires:Date.now()+MAX_AGE_MS});
  totalChars+=json.length;
  while(completed.size>MAX_ENTRIES||totalChars>MAX_TOTAL_CHARS)
    discard(completed.keys().next().value);
}

/**
 * Result reuse for fixed, public anonymous SELECT projections. A trusted
 * revision vector allows a completed result to be reused; no TTL-only correctness.
 * Reads on unsupported dialects and unversioned tables remain live.
 */
export async function withPublicSqlResultCache({
  env,db,engine,namespace,targetId,scope,kind,start='',end='',feature='',
  dependencies,read
}){
  if(typeof read!=='function')throw new TypeError('SQL result reader required');
  if(env?.LOC_SQL_RESULT_CACHE!=='1'||engine!=='postgres'||namespace!=='silver')
    return read();
  const names=dependencyNames(dependencies);
  if(!names||typeof db?.selectFrom!=='function')return read();
  let vector;
  try{vector=await revisionsFor(db,names)}
  catch{return read()} // Not migrated / not permitted: never return stale data.
  if(!vector)return read();
  // The caller has already enforced SCOPE_ROUTE_INDEX and guest feature flags.
  // Policy class, SQL target, scope, normalized parameters and exact database
  // revision vector all participate in the cache key.
  const key=JSON.stringify(['public-anon-policy-v2',targetId,engine,namespace,
    scope,kind,start,end,feature,vector]);
  const cached=completed.get(key);
  if(cached){
    if(cached.expires>Date.now()){
      // Refresh LRU order without changing its accounted size.
      completed.delete(key);
      completed.set(key,cached);
      return JSON.parse(cached.json);
    }
    discard(key);
  }
  const inProgress=pending.get(key);
  if(inProgress)return JSON.parse(await inProgress);
  const task=(async()=>{
    const data=await read();
    const json=JSON.stringify(data);
    if(json!==undefined&&json.length<=MAX_RESULT_CHARS)remember(key,json);
    return json;
  })();
  pending.set(key,task);
  try{
    const json=await task;
    return json===undefined?undefined:JSON.parse(json);
  }finally{if(pending.get(key)===task)pending.delete(key)}
}

// Retain existing call-sites and test imports; there is only one cache store.
export const withNumericSqlResultCache=withPublicSqlResultCache;
