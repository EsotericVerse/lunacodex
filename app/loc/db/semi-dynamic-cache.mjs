'use client';

// Shared read cache for data that only changes when an admin explicitly
// saves something (theme colors, runtime limits, the scope registry tree,
// group member names, backup status) — not on every clock tick, not on
// every mount. Cache forever; the one and only thing that ever drops an
// entry is a successful save for that exact key. No TTL, no polling, no
// background re-check: there is nothing "semi" about it. If a save path
// exists, it invalidates. If no save path exists for some data, it has no
// business going through this file at all — read it once as a plain
// static value instead (see app/loc/scope/scope-data.js's own Maps, which
// follow this same forever-until-invalidated shape for public reads).
const entries=new Map(); // small, explicit-save management snapshots
const aggregateEntries=new Map(); // published/aggregate reads, LRU only
// A memory safety bound, NOT a time-to-live or a resource percentage.
// Entries outside the working set are reloaded on demand if visited again.
const MAX_AGGREGATE_KEYS=96;
const cacheFor=key=>key.startsWith('scope-aggregate:')?aggregateEntries:entries;

/**
 * Read `key`, sharing one in-flight/resolved promise across every caller
 * until explicitly invalidated. A failed read is removed immediately so
 * the next read tries again instead of caching the error.
 */
export function cachedRead(key,fetcher){
  const cacheKey=String(key||'');
  const cache=cacheFor(cacheKey);
  const existing=cache.get(cacheKey);
  if(existing){
    if(cache===aggregateEntries){cache.delete(cacheKey);cache.set(cacheKey,existing);}
    return existing;
  }
  let promise;
  promise=Promise.resolve().then(fetcher).catch(error=>{
    // A failed old read must not remove a newer snapshot started after save.
    if(cache.get(cacheKey)===promise)cache.delete(cacheKey);
    throw error;
  });
  cache.set(cacheKey,promise);
  if(cache===aggregateEntries)while(cache.size>MAX_AGGREGATE_KEYS)
    cache.delete(cache.keys().next().value);
  return promise;
}

/** Drop one cached key. Call this right after a save for that key succeeds. */
export function invalidateCachedRead(key){
  const cacheKey=String(key||'');
  cacheFor(cacheKey).delete(cacheKey);
}

/** Drop every cached key starting with `prefix` (e.g. a scope id). */
export function invalidateCachedReadPrefix(prefix){
  const text=String(prefix||'');
  for(const cache of [entries,aggregateEntries])
    for(const key of [...cache.keys()])
      if(key.startsWith(text))cache.delete(key);
}

/**
 * Clear only management snapshots that belong to an authenticated browser
 * identity. Public Scope configuration and presentation data are unaffected.
 * Called when an identity changes, signs out, or a live permission check fails.
 */
export function invalidateAccountPrivateReads(){
  invalidateCachedReadPrefix('loc-group-member-list:');
  invalidateCachedRead('admin-runtime-io:loc');
}
