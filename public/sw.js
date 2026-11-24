/* LOC Service Worker retirement stub.
 * Service Worker registration/caching is disabled in ALL Web environments.
 * Keep this URL available so a browser carrying a legacy registration can
 * update to a worker without a fetch handler, erase LOC-owned asset caches
 * and unregister itself. This is NOT an offline or caching worker.
 *
 * Only remove caches previously owned by LOC. Never touch other caches,
 * user storage, cookies, sessions, SQL or authentication.
 */
self.addEventListener('install',event=>{
  event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    // Unregister first. A prior controller may remain on an already-open tab
    // until navigation, so AppShell also retires LOC caches on each load.
    await self.registration.unregister();
    const names=await caches.keys();
    await Promise.all(names.filter(name=>
      name.startsWith('loc-static-next-')||
      name.startsWith('loc-static-preact-')||
      name.startsWith('loc-public-')).map(name=>caches.delete(name)));
  })());
});
// No fetch listener, clients.claim, periodic sync or other background tasks.
