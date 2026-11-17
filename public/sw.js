/* LOC browser-only Service Worker for immutable Next.js assets.
 * Static HTML, API, SQL, session/OAuth and all images remain network-owned.
 * No ISR, background refresh, or persistent Galaxy data cache.
 */
const CACHE='loc-static-next-v1';
const MAX_ENTRIES=120;
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  const names=await caches.keys();
  await Promise.all(names.filter(name=>name.startsWith('loc-public-')||name.startsWith('loc-static-next-')&&name!==CACHE)
    .map(name=>caches.delete(name)));
  await self.clients.claim();
})()));
function eligible(request){
  if(request.method!=='GET'||request.destination==='document'||request.mode==='navigate')return false;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin||!url.pathname.startsWith('/_next/static/'))return false;
  return /\.(?:js|css|woff2?)$/i.test(url.pathname);
}
self.addEventListener('fetch',event=>{
  const request=event.request;
  if(!eligible(request))return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    const hit=await cache.match(request);
    if(hit)return hit;
    const response=await fetch(request);
    if(response.ok&&response.type==='basic'){
      await cache.put(request,response.clone()).catch(()=>{});
      const keys=await cache.keys();
      if(keys.length>MAX_ENTRIES)
        await Promise.all(keys.slice(0,keys.length-MAX_ENTRIES).map(key=>cache.delete(key)));
    }
    return response;
  })());
});
