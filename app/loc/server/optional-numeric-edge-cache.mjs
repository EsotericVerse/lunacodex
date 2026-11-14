// Optional Pages Function numeric acceleration, not Next.js ISR.
// Default OFF. Never cache Auth, private data, metadata, or SQL permissions.
// The existing ZenStack/Kysely reader is ALWAYS the authoritative fallback.
// No SQL dialect hook, database revision table, polling, or new service.
import {SCOPE_ROUTE_INDEX} from '../../modular/scope-route-index.js';
import {scopeFeatureEnabled} from '../scope-config-fields.mjs';
import {DATABASE_ACCESS_LIST} from '../providers/access.js';

const TTL_SECONDS=60;
const CACHE_FORMAT='loc-public-numeric-v1';
const CACHED_KINDS=new Set(['daily_total','totals','loc']);
const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const DAY=/^\d{4}-\d{2}-\d{2}$/;

// Validate the public route BEFORE any cache hit. The Pages runtime and
// committed published feature index remain the authority for the response.
// Bad inputs and unpublished scopes always use the ordinary handler (which
// supplies its own 400/403 and never gets cached by this module).
function publicNumericCacheKey(request,env){
  if(request?.method!=='GET'||request.headers?.has('authorization')||
     request.headers?.has('cookie')||request.headers?.has('range'))
    return null;
  const url=new URL(request.url);
  if(url.pathname!=='/api/loc-public-content')return null;
  const fields=[...url.searchParams.keys()];
  if(fields.length>4||new Set(fields).size!==fields.length||
     fields.some(field=>!['kind','scope','start','end'].includes(field)))
    return null;
  const kind=url.searchParams.get('kind')||'';
  const scope=url.searchParams.get('scope')||'';
  if(!CACHED_KINDS.has(kind)||!SCOPE.test(scope)||
     (kind==='loc')!==(scope==='loc'))
    return null;
  const published=SCOPE_ROUTE_INDEX.find(row=>row.scope_id===scope);
  if(!published||published.active===false||
     !scopeFeatureEnabled(published.config,'statistics_able'))
    return null;
  const start=url.searchParams.get('start')||'';
  const end=url.searchParams.get('end')||'';
  if(kind==='daily_total'&&(!start||!end))return null;
  if(Boolean(start)!==Boolean(end)||
     (start&&(!DAY.test(start)||!DAY.test(end)||start>end)))return null;

  // Keep replacement deployments and selected SQL targets partitioned.
  // This partition is never a user input or a SQL identifier.
  const release=/^[a-f0-9]{40}$/i.test(String(env?.CF_PAGES_COMMIT_SHA||''))
    ?env.CF_PAGES_COMMIT_SHA:'unknown';
  const target=DATABASE_ACCESS_LIST.find(row=>row.selected===true)?.target_id||'none';
  url.search='';
  url.searchParams.set('_loc_cache',CACHE_FORMAT);
  url.searchParams.set('_release',release);
  url.searchParams.set('_target',target);
  url.searchParams.set('kind',kind);
  url.searchParams.set('scope',scope);
  if(start){url.searchParams.set('start',start);url.searchParams.set('end',end)}
  return url.toString();
}

function clientResponse(cached){
  // Cache API stores a public max-age so Cloudflare can retain the snapshot.
  // Never give the browser a persistent cache: the owner may disable this
  // acceleration without needing to clear users' local HTTP caches.
  const headers=new Headers(cached.headers);
  headers.set('cache-control','no-store');
  headers.set('x-loc-numeric-edge','HIT');
  return new Response(cached.body,{
    status:cached.status,statusText:cached.statusText,headers
  });
}

/**
 * Optional Cloudflare Pages Function cache for three already-public numeric
 * projections. A hit avoids the SQL query; a miss performs the SAME query.
 *
 * Cloudflare Cache API does not support stale-while-revalidate; do not
 * advertise this as Next.js ISR. It is a bounded best-effort edge accelerator.
 */
export async function withOptionalNumericEdgeCache(context,read){
  if(context?.env?.LOC_NUMERIC_EDGE_CACHE!=='1')return read();
  // No waitUntil => no asynchronous fill; don't add an extra cache lookup.
  if(typeof context?.waitUntil!=='function'||typeof caches==='undefined'||
     !caches?.default?.match||!caches.default.put)
    return read();
  const key=publicNumericCacheKey(context.request,context.env);
  if(!key)return read();
  const cache=caches.default;
  try{
    const hit=await cache.match(key);
    if(hit?.status===200&&
       hit.headers?.get('content-type')?.startsWith('application/json')&&
       !hit.headers.has('set-cookie'))
      return clientResponse(hit);
  }catch{
    return read(); // Cache unavailable must never block normal SQL reads.
  }

  const fresh=await read();
  if(fresh?.status===200&&
     fresh.headers?.get('content-type')?.startsWith('application/json')&&
     !fresh.headers.has('set-cookie')){
    try{
      const headers=new Headers(fresh.headers);
      headers.set('cache-control','public, max-age='+TTL_SECONDS);
      // Store a separate body stream; the normal response stays no-store.
      const snapshot=new Response(fresh.clone().body,{
        status:fresh.status,statusText:fresh.statusText,headers
      });
      context.waitUntil(Promise.resolve(cache.put(key,snapshot)).catch(()=>{}));
    }catch{
      // A cache failure is invisible to the reader; data is already live.
    }
  }
  return fresh;
}
