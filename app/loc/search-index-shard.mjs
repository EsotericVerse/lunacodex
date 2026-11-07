// Pure logical identity and partitioning, shared by index builder and KV Worker.
// The database vendor, endpoint, or time range never enters a document ID.
import {locGlobalUid} from '../../zenstack/global-identity.mjs';

export const LOC_SEARCH_INDEX_SHARDS=32;
export function locSearchDocumentId({scopeId,dbId,entityType='galaxy',uid}){
  // Reuse the virtual ZModel federation contract (PR #1219); do not mint
  // a second incompatible UID composition for the search layer.
  const globalUid=locGlobalUid({databaseId:dbId,scopeId,uid});
  if(!/^[a-z][a-z0-9_]{0,31}$/.test(entityType))
    throw new Error('Invalid LOC Search entity type');
  return JSON.stringify([entityType,globalUid]);
}
export function locSearchShard(uid){
  let x=2166136261;
  for(const ch of String(uid)){x^=ch.codePointAt(0);x=Math.imul(x,16777619);}
  return (x>>>0)%LOC_SEARCH_INDEX_SHARDS;
}
