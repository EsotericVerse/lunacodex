// Search QoS applies only to explicit text predicates. Read-by-UID,
// Culture, Statistics, Trace and normal article lists must never be throttled.
export function isTextSearchQuery(body){
  if(body?.kind!=='query'||body.operation!=='select'||
     !/_galaxy$/.test(String(body.table||'')))return false;
  // LOC text search is exclusively Galaxy.content, never Anchor.description.
  const fields=new Set(['content']);
  const filters=Array.isArray(body.filters)?body.filters:[];
  if(filters.some(f=>fields.has(f?.column)&&['ilike','like','contains'].includes(f.operator)))return true;
  const expressions=Array.isArray(body.or)?body.or:[];
  return expressions.some(expr=>typeof expr==='string'&&
    [...fields].some(field=>new RegExp('(?:^|[^a-z_])'+field+'\\.(?:ilike|like|contains)\\.','i').test(expr)));
}

// A warm Edge isolate's bounded memory map avoids a DB write per search.
// This is defense-in-depth, not a globally shared IP blacklist.
export function createSearchQos({now=()=>Date.now(),max=24,windowMs=60000,
  minIntervalMs=0,blockMs=120000,maxEntries=4096}={}){
  const entries=new Map();
  return function check(key){
    const identity=String(key||'').slice(0,256)||'anonymous-unknown';
    const time=now();
    let entry=entries.get(identity);
    if(!entry)entry={times:[],blockedUntil:0,lastAccepted:0};
    if(entry.blockedUntil>time)return {allowed:false,retryAfterMs:entry.blockedUntil-time,blocked:true};
    entry.blockedUntil=0;
    entry.times=entry.times.filter(t=>time-t<windowMs);
    // Count individual SQL search requests, not browser search actions. A
    // single user query may legitimately fan out across multiple Scopes and
    // the Galaxy providers. Do not impose per-request spacing here;
    // the UI enforces search-action spacing separately.
    // Count attempts even when spacing is denied, so repeated spam
    // eventually enters a temporary blacklist.
    entry.times.push(time);
    if(entry.times.length>max){
      entry.blockedUntil=time+blockMs;
      entries.set(identity,entry);
      return {allowed:false,retryAfterMs:blockMs,blocked:true};
    }
    const spacing=entry.lastAccepted?minIntervalMs-(time-entry.lastAccepted):0;
    entries.delete(identity);
    entries.set(identity,entry);
    if(entries.size>maxEntries)entries.delete(entries.keys().next().value);
    if(spacing>0)return {allowed:false,retryAfterMs:spacing,blocked:false};
    entry.lastAccepted=time;
    return {allowed:true,retryAfterMs:0,blocked:false};
  };
}
export const checkSearchQos=createSearchQos();
