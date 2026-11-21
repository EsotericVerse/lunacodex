/* LOC browser-only Service Worker for immutable Next.js assets.
 * Static HTML, API, SQL, session/OAuth and all images remain network-owned.
 * No ISR, background refresh, or persistent Galaxy data cache.
 */
const CACHE='loc-static-next-v1';
const MAX_ENTRIES=120;
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  const names=await caches.keys();
  // Framework rollbacks must retire the old Preact/esbuild asset cache too.
  // Only LOC-owned, browser-static asset caches are affected. HTML, DB and OAuth
  // have never been cached by this worker.
  await Promise.all(names.filter(name=>
    name!==CACHE&&(name.startsWith('loc-public-')||
      name.startsWith('loc-static-next-')||name.startsWith('loc-static-preact-')))
    .map(name=>caches.delete(name)));
  await self.clients.claim();
})()));
function eligible(request){
  if(request.method!=='GET'||request.destination==='document'||request.mode==='navigate')return false;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin||!url.pathname.startsWith('/_next/static/'))return false;
  return /\.(?:js|css|woff2?)$/i.test(url.pathname);
}
// Never persist a redirected login/error page or a private/no-store reply
// under a hashed JS URL. The public build must serve an expected MIME type.
function cacheable(request,response){
  if(!response.ok||response.type!=='basic'||response.redirected)return false;
  const type=String(response.headers?.get('content-type')||'').toLowerCase();
  const policy=String(response.headers?.get('cache-control')||'');
  if(/\b(?:private|no-store)\b/i.test(policy))return false;
  const path=new URL(request.url).pathname;
  if(/\.js$/i.test(path))return /(?:javascript|ecmascript)/.test(type);
  if(/\.css$/i.test(path))return /^text\/css(?:;|$)/.test(type);
  if(/\.woff2?$/i.test(path))
    return /^(?:font\/woff2?|application\/(?:font-woff2?|octet-stream))(?:;|$)/.test(type);
  return false;
}
self.addEventListener('fetch',event=>{
  const request=event.request;
  if(!eligible(request))return;
  event.respondWith((async()=>{
    // Cache Storage can be unavailable (private mode, quota or eviction).
    // Never let that failure turn a valid JS/CSS download into a blank page.
    let cache=null;
    try{
      cache=await caches.open(CACHE);
      const hit=await cache.match(request);
      if(hit)return hit;
    }catch{cache=null;}
    const response=await fetch(request);
    if(cache&&cacheable(request,response)){
      try{
        await cache.put(request,response.clone());
        const keys=await cache.keys();
        if(keys.length>MAX_ENTRIES)
          await Promise.all(keys.slice(0,keys.length-MAX_ENTRIES)
            .map(key=>cache.delete(key)));
      }catch{
        // Best-effort persistence; successful network response stays valid.
      }
    }
    return response;
  })());
});
