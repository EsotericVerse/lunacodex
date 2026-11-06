import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const readJson=file=>JSON.parse(read(file));
const routes=readJson('.next/server/app-paths-manifest.json');

// Emergency release requirement: source must remain independent of remote ISR.
const numeric='app/api/loc/scopes/[scopeId]/numeric/[kind]/route.js';
const invalidation='app/api/loc/revalidate/route.js';
const appPath=file=>'/'+file.replace(/^app\//,'').replace(/\.js$/,'');
for(const name of [numeric,invalidation]){
  if(!routes[appPath(name)])throw Error('Missing Next route '+name);
}
for(const route of [
  'app/api/loc/site-bootstrap/route.js',
  'app/api/loc/scopes/[scopeId]/config/route.js',
  'app/api/loc/scopes/[scopeId]/blocks/[pageName]/route.js'
]){
  if(fs.existsSync(path.join(root,route)))throw Error('Legacy ISR route still present: '+route);
}
const numericSource=read(numeric),invalidateSource=read(invalidation);
// ISR routes are prepared but refuse requests unless Admin enables mode=isr.
// Deployment continues to be a separate manual user action.
const guards=read('app/api/loc/_numeric-failover.mjs');
const publicServer=read('app/api/loc/_server.js');
if(!numericSource.includes('readIsrSummary(')||
   !numericSource.includes('tryPublicSources(publicNumericSources()')||
   !guards.includes("db.from('manage')")||
   !guards.includes("cache_mode!=='isr'")||
   !guards.includes(".select('caches')")||
   !guards.includes('origin')||
   !numericSource.includes('no-store')||!invalidateSource.includes('status:410'))

  throw Error('ISR must remain admin-gated; revalidation writes remain disabled');
if(/service_role|SUPABASE_SERVICE_ROLE_KEY|unstable_cache|revalidateTag/.test(numericSource+guards+publicServer))
  throw Error('Optional numeric endpoint must use public RPC and standard HTTP caching');
if(!publicServer.includes('LOC_BACKUP_SQL_GATEWAY_URL')||
   !publicServer.includes('AbortSignal.timeout(6500)')||
   !guards.includes('isAvailabilityFailure('))
  throw Error('ISR must retain independent bounded portable SQL backup');
const openNext=read('open-next.config.ts'),wrangler=readJson('wrangler.jsonc');
if(!openNext.includes('static-assets-incremental-cache')||
  /r2-incremental-cache|do-queue|do-sharded-tag-cache/.test(openNext))
  throw Error('OpenNext must use the read-only Static Assets cache');
if(wrangler.r2_buckets||wrangler.durable_objects)
  throw Error('Worker still contains billable ISR cache bindings');
const numericClient=read('app/loc/numeric-isr-client.js');
if(!numericClient.includes("mode==='isr'")||!numericClient.includes('readNumericIsr')||
  !numericClient.includes('credentials:\'omit\''))
  throw Error('Remote ISR must remain optional and use only anonymous public reads');
const cacheMode=read('app/loc/cache-mode-client.mjs');
if(!cacheMode.includes('cache-policy.config')||!cacheMode.includes('CACHE_POLICY')||
  cacheMode.includes('loc_cache_runtime'))
  throw Error('Public three-mode policy must fail safely without enabling ISR');
const sw=read('public/sw.js');
if(!sw.includes("runtimeCacheMode==='off'")||!sw.includes('LOC_CACHE_POLICY'))
  throw Error('SW must preserve its installation but support cache bypass');
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
const worker=read('public/sw.js');
if(!worker.includes('isStaticAsset(request,url)')||!worker.includes('staticStrategy(event)')||
   !worker.includes('_next\\/static'))
  throw Error('Service Worker must cache published Next.js JS/CSS assets');
console.log('Verified default-off optional ISR, admin-gated public numeric HTTP cache, SW bypass and published JS policy.');
