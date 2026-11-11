// In-process, Scope-keyed SQL aggregation cache. The underlying ZModel/Kysely
// query runs only when absent or explicitly invalidated after a committed write.
// No periodic TTL, polling, extra database connection or schema migration.
const entries=new Map();
const keyFor=(scopeId,kind,args)=>JSON.stringify([String(scopeId),kind,args]);

export function readScopeStatisticsCached(scopeId,kind,args,read){
  const key=keyFor(scopeId,kind,args);
  const old=entries.get(key);
  if(old)return old.promise;
  const promise=Promise.resolve().then(read);
  entries.set(key,{scopeId:String(scopeId),promise});
  promise.catch(()=>{
    // A failed read must be retryable, but a late failure cannot erase a
    // newer entry created after explicit write invalidation.
    if(entries.get(key)?.promise===promise)entries.delete(key);
  });
  return promise;
}

export function invalidateScopeStatisticsCached(scopeId){
  const id=String(scopeId||'');
  if(!id)return;
  for(const [key,entry] of entries)
    if(entry.scopeId===id)entries.delete(key);
}
