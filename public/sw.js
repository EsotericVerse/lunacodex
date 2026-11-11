/* LOC PWA Service Worker retirement.
 * This file remains at /sw.js so previously installed PWA registrations
 * can update to this no-fetch-handler worker, clear old LOC caches and
 * unregister themselves. It intentionally caches and intercepts NOTHING.
 * Cloudflare server Workers and Capacitor native functionality are separate.
 */
self.addEventListener('install',event=>{
  event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    try{
      const keys=await caches.keys();
      await Promise.all(keys.filter(name=>name.startsWith('loc-public-'))
        .map(name=>caches.delete(name)));
    }finally{
      await self.registration.unregister();
    }
  })());
});
