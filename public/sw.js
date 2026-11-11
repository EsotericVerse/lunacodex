/* LOC PWA: immutable JS/CSS and public images only.
 * Page HTML, culture/search/trace data, SQL and Auth always pass straight
 * through the network; never serve a stale shell as a successful data read.
 * Capacitor native is intentionally not controlled by this worker. */
const IMAGE_CACHE='loc-public-images-v1', IMAGE_PREFIX='loc-public-images-', MAX_IMAGES=200;
const PAGE_PREFIX='loc-public-html-';
const STATIC_CACHE='loc-public-static-v1', STATIC_PREFIX='loc-public-static-', MAX_STATIC=150;
const LEGACY_BLOCK_PREFIX='loc-public-block';
const PRIVATE_QUERY=/^(?:token|access_token|auth|authorization|jwt|key|api_key|sig|signature|expires?|policy|credential|x-amz-|x-goog-|x-ms-)/i;
const PRIVATE_PATH=/(?:^|\/)(?:auth|private|account|user|session)(?:\/|$)/i;
const MANAGEMENT_PATH=/(?:^|\/)manage(?:\/|$)/i;
const IMAGE_EXT=/\.(?:avif|gif|jpe?g|png|svg|webp|bmp|ico)$/i;
function urlFor(request){
  if(request.method!=='GET'||request.headers?.has('authorization'))return null;
  let url;
  try{url=new URL(request.url);}catch{return null;}
  if(url.username||url.password)return null;
  for(const key of url.searchParams.keys())if(PRIVATE_QUERY.test(key))return null;
  return url;
}
function isImage(request,url){
  if(request.destination!=='image')return false;
  if(url.origin===self.location.origin)return /^\/(?:pics|assets|vendor)\//.test(url.pathname);
  return url.protocol==='https:'&&!PRIVATE_PATH.test(url.pathname)&&IMAGE_EXT.test(url.pathname);
}
function isStaticAsset(request,url){
  return url.origin===self.location.origin&&!url.search&&
    /^\/_next\/static\/.+\.(?:js|css)$/.test(url.pathname)&&
    ['script','style',''].includes(request.destination||'');
}
function cacheable(response,type){
  if(!response||!response.ok||response.status!==200||response.redirected)return false;
  const headers=response.headers;
  if(/\b(?:no-store|private|no-cache)\b/i.test(headers.get('cache-control')||''))return false;
  if(/(?:^|,)\s*(?:cookie|authorization|\*)\s*(?:,|$)/i.test(headers.get('vary')||''))return false;
  return type.test(headers.get('content-type')||'');
}
function cacheableImage(response){
  if(!response||(response.type!=='opaque'&&!response.ok))return false;
  if(response.type==='opaque')return true;
  const policy=response.headers.get('cache-control')||'';
  if(/\b(?:no-store|private|no-cache)\b/i.test(policy))return false;
  return !response.headers.get('content-type')||/^image\//i.test(response.headers.get('content-type'));
}
async function keep(cache,request,response,limit){
  await cache.put(request,response);
  const keys=await cache.keys();
  const removed=keys.slice(0,Math.max(0,keys.length-limit));
  await Promise.all(removed.map(key=>cache.delete(key)));
  return removed;
}
async function staticStrategy(event){
  const request=event.request;
  let cache;
  try{cache=await caches.open(STATIC_CACHE);const hit=await cache.match(request);if(hit)return hit;}catch{}
  const response=await fetch(request);
  if(cache&&cacheable(response,/^(?:text\/css|(?:text|application)\/javascript)(?:;|$)/i))
    event.waitUntil(keep(cache,request,response.clone(),MAX_STATIC).catch(()=>{}));
  return response;
}
async function imageStrategy(event){
  const request=event.request;
  let cache;
  try{cache=await caches.open(IMAGE_CACHE);const hit=await cache.match(request);if(hit)return hit;}catch{}
  // Optional provider-neutral shared image origin. CDN/Worker may cache the
  // same public assets across visitors. If unreachable, retain the site image.
  let response=null;
  if(runtimeCacheMode==='isr'&&runtimeImageOrigin&&
     urlFor(request)?.origin===self.location.origin){
    try{
      const source=new URL(request.url),cdn=new URL(source.pathname+source.search,runtimeImageOrigin);
      // Only this site's public immutable image directories are mirrored.
      if(/^\/(?:pics|assets|vendor)\//.test(source.pathname)){
        // Bound optional edge latency: a failed ISR origin must not stall images.
        const edge=await fetch(cdn.href,{mode:'cors',credentials:'omit',
          signal:AbortSignal.timeout(1500)});
        if(edge.ok&&/^image\//i.test(edge.headers.get('content-type')||''))
          response=edge;
      }
    }catch{ /* Missing edge deploy/CORS: use unchanged original image URL. */ }
  }
  response??=await fetch(request);
  if(cache&&cacheableImage(response))event.waitUntil(keep(cache,request,response.clone(),MAX_IMAGES).catch(()=>{}));
  return response;
}
// A Service Worker stays installed for all modes. 'off' simply bypasses its
// optional response caches; browser built-in HTTP caching is outside SW control.
let runtimeCacheMode='off',runtimeImageOrigin='';
self.addEventListener('message',event=>{
  if(event.data?.type!=='LOC_CACHE_POLICY')return;
  const mode=event.data.mode;
  if(mode!=='off'&&mode!=='cache'&&mode!=='isr')return;
  const candidate=String(event.data.origin||'');
  const valid=/^https:\/\/[a-z0-9][a-z0-9.-]*[a-z0-9]$/i.test(candidate);
  runtimeCacheMode=mode;
  runtimeImageOrigin=mode==='isr'&&valid?candidate:'';
});
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  const names=await caches.keys();
  await Promise.all(names.filter(name=>
    (name.startsWith(IMAGE_PREFIX)&&name!==IMAGE_CACHE)||
    name.startsWith(PAGE_PREFIX)||
    name.startsWith(LEGACY_BLOCK_PREFIX)||
    (name.startsWith(STATIC_PREFIX)&&name!==STATIC_CACHE)
  ).map(name=>caches.delete(name)));
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  const request=event.request,url=urlFor(request);
  if(!url||runtimeCacheMode==='off')return;
  if(isStaticAsset(request,url))event.respondWith(staticStrategy(event));
  else if(isImage(request,url))event.respondWith(imageStrategy(event));

});
