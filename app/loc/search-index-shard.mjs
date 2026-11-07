// Pure logical identity and partitioning, shared by index builder and KV Worker.
// The database vendor, endpoint, or time range never enters a document ID.
export const LOC_SEARCH_INDEX_SHARDS=32;
export function locSearchDocumentId({scopeId,dbId,entityType='galaxy',uid}){
  return JSON.stringify([scopeId,dbId,entityType,uid]);
}
export function locSearchShard(uid){
  let x=2166136261;
  for(const ch of String(uid)){x^=ch.codePointAt(0);x=Math.imul(x,16777619);}
  return (x>>>0)%LOC_SEARCH_INDEX_SHARDS;
}
