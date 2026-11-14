import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd();
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const routes=JSON.parse(read('.next/server/app-paths-manifest.json'));

// Old optional ISR cannot be revived by leaving code, Workers or a route
// behind an administrative flag. Public pages use committed JS snapshots.
const retired=[
  "app/api/loc/isr-capabilities/route.js",
  "app/api/loc/revalidate/route.js",
  "app/api/loc/scopes/[scopeId]/numeric/[kind]/route.js",
  "app/api/loc/_numeric-failover.mjs",
  "app/api/loc/_server.js",
  "workers/loc-isr/wrangler.jsonc",
  "workers/loc-isr/open-next.config.ts",
  "app/loc/numeric-isr-client.js",
  "app/loc/cache-mode-client.mjs",
  "app/loc/cache-policy.config.mjs",
  "app/loc/providers/isr-domains.mjs",
  "app/loc/runtime-cache-fields.mjs",
  "scripts/verify-release-isr.mjs",
  "app/api/loc/site-bootstrap/route.js",
  "app/api/loc/scopes/[scopeId]/config/route.js",
  "app/api/loc/scopes/[scopeId]/blocks/[pageName]/route.js"
];
const present=retired.filter(file=>fs.existsSync(path.join(root,file)));
if(present.length)throw Error('Retired ISR files still present: '+present.join(', '));
const retiredRoutes=['/api/loc/isr-capabilities/route','/api/loc/revalidate/route',
  '/api/loc/scopes/[scopeId]/numeric/[kind]/route'];
const built=Object.keys(routes).filter(route=>retiredRoutes.includes(route));
if(built.length)throw Error('Retired ISR route still built: '+built.join(', '));
const runtime=read('app/loc/runtime-config.mjs');
const backend=read('app/loc/providers/kysely-management.mjs');
const io=read('app/loc/query-batch-size.mjs');
// Only the strictly disabled Vercel ISR reservation may coexist with I/O.
// No legacy ISR endpoint, Worker, route or active switch may be restored.
if(!runtime.includes("const allowed=['io_limits','isr']")||
   !backend.includes("new Set(['io_limits','isr'])")||
   !backend.includes('encodeRuntimeIo(')||
   !io.includes("if(settings.enabled!==undefined&&settings.enabled!==false)")||
   !io.includes("throw new Error('Vercel ISR 尚未開放啟用')"))
  throw Error('Runtime ISR reservation must be disabled and authorized');
// Browser PWA Service Worker has also been retired.
const sw=read('public/sw.js');
const shell=read('app/AppShell.jsx');
if(!sw.includes('self.registration.unregister()')||
   sw.includes("addEventListener('fetch'")||
   shell.includes('serviceWorker.register('))
  throw Error('Retired PWA worker must not intercept or re-register');
const config=read('app/loc/scope-data.js');
if(!config.includes('PUBLISHED_SITE_BOOTSTRAP')||
  !config.includes('SCOPE_ROUTE_INDEX')||
  !config.includes('loadPublishedBlocks(id,pageName)'))
  throw Error('Missing published JS Bootstrap/Config/Blocks sources');
const routesConfig=read('app/modular/scope-route-index.js');
if(!routesConfig.includes('SCOPE_ROUTE_INDEX')||!routesConfig.includes('"config":'))
  throw Error('Scope Routes and Config must share one public JS module');
const publishedBlocks=read('app/modular/published-blocks/index.js');
if(!publishedBlocks.includes('()=>import('))
  throw Error('Scope Blocks must use page-level JS lazy imports');
const app=read('app/loc/app-bootstrap.js');
if(app.includes('locHomeSnapshotDelivered'))
  throw Error('LOC home still consumes site RPC Blocks');
console.log('Verified retired ISR endpoints/workers, IO-only settings, retired PWA worker and published JS policy.');
