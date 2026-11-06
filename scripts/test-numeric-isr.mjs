import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import vm from 'node:vm';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('optional ISR is used only in explicit ISR mode and always bounded',async()=>{
  const source=read('app/loc/numeric-isr-client.js');
  let mode='off',requests=[];
  const context=vm.createContext({
    URL,AbortSignal,Error,
    fetch:async url=>{requests.push(url);return {ok:true,json:async()=>({rows:[{day:'2026-10-26'}]})};}
  });
  const stub=new vm.SyntheticModule(['currentCachePolicy'],function(){
    this.setExport('currentCachePolicy',()=>({mode,origin:'https://isr.example.com'}));
  },{context});
  const mod=new vm.SourceTextModule(source,{context});
  await mod.link(specifier=>{
    assert.equal(specifier,'./cache-mode-client.mjs');
    return stub;
  });
  await mod.evaluate();
  for(const id of ['loc','lo3rwang','lrunes','local','admin']){
    assert.equal(mod.namespace.usesNumericIsr(id),false,id);
  }
  mode='cache';
  assert.equal(mod.namespace.usesNumericIsr('loc'),false);
  mode='isr';
  assert.equal(mod.namespace.usesNumericIsr('local'),false);
  assert.equal(mod.namespace.usesNumericIsr('lo3rwang'),true);
  const data=await mod.namespace.readNumericIsr('lo3rwang','culture',{startDate:'2026-10-26'});
  assert.equal(data.rows[0].day,'2026-10-26');
  assert.match(requests[0],/^https:\/\/isr\.example\.com\/api\/loc\/scopes\/lo3rwang\/numeric\/culture\?/);
  assert.equal(requests.length,1);
  await assert.rejects(mod.namespace.readNumericIsr('../admin','culture'),/unavailable/);
});

test('ISR server route checks global mode, validates scope and is safe for disabled mode',()=>{
  const source=read('app/api/loc/scopes/[scopeId]/numeric/[kind]/route.js');
  const guard=read('app/api/loc/_numeric-failover.mjs');
  const publicServer=read('app/api/loc/_server.js');
  assert.match(guard,/cache_mode!=='isr'/);
  assert.match(guard,/decodeLocCache/);
  assert.match(guard,/db\\.from\\('manage'\\)/);
  assert.match(guard,/isAvailabilityFailure/);
  assert.match(source,/readIsrSummary\(db,\{origin:url\.origin,args\}\)/);
  assert.match(source,/tryPublicSources\(publicNumericSources\(\)/);
  assert.match(publicServer,/LOC_BACKUP_SQL_GATEWAY_URL/);
  assert.doesNotMatch(publicServer,/NEON_AUTH_URL|@supabase\/postgrest-js/);
  assert.match(source,/status===200\?CACHE_HEADERS:NO_CACHE/);
  assert.match(source,/p_view:view/);
  assert.doesNotMatch(source,/read_scope_analytics|\.rpc\(/);
  assert.match(source,/no-store/);
  assert.doesNotMatch(source,/service_role|SUPABASE_SERVICE_ROLE_KEY|createClient\([^,]+,[^,]+\s*\)/);
});

test('Worker and OpenNext cannot write R2 or Durable Object caches',()=>{
  const openNext=read('open-next.config.ts');
  const wrangler=JSON.parse(read('wrangler.jsonc'));
  assert.match(openNext,/static-assets-incremental-cache/);
  assert.doesNotMatch(openNext,/r2-incremental-cache|do-queue|do-sharded-tag-cache/);
  for(const name of ['r2_buckets','durable_objects','migrations'])assert.equal(wrangler[name],undefined);
  assert.equal(wrangler.assets.binding,'ASSETS');
});

test('Culture, Statistics, Periods, Daily Runes and Trace have direct data providers',()=>{
  const galaxy=read('app/loc/galaxy-query.js');
  const culture=read('app/modular/features/Culture.jsx');
  const stats=read('app/modular/features/Statistics.jsx');
  const daily=read('app/lrunes/DailyRuneAnalytics.jsx');
  const traces=read('app/modular/features/trace/TracePlaceResults.jsx');
  const places=read('app/loc/place-summary-client.js');
  // scopeStatisticsRows calls the direct analytics provider through a short-TTL
  // dedupe wrapper (cachedReadScopeStatistics) so two charts for the same
  // Scope/range in one render share one request; the wrapper itself still
  // calls readScopeStatistics(id,args) directly, so both are checked here.
  assert.match(galaxy,/cachedReadScopeStatistics\(current\.id/);
  assert.match(galaxy,/function cachedReadScopeStatistics\(id,args\)\{/);
  assert.match(galaxy,/\(\)=>readScopeStatistics\(id,args\)/);
  assert.match(galaxy,/readScopeOverview\(current\.id/);
  assert.match(galaxy,/readLocStatistics\(/);
  assert.match(culture,/selectScopePeriodSourceSnapshot/);
  assert.match(stats,/selectScopeCultureData\(scopeId\)/);
  assert.match(daily,/selectDailyRuneRange\(range\)/);
  assert.match(traces,/\.analytics\(/);
  assert.match(places,/read_scope_place_statistics/);
  assert.match(places,/Capacitor\.isNativePlatform/);
});

test('Service Worker and published JS remain independently usable',()=>{
  assert.match(read('public/sw.js'),/staticStrategy\(event\)/);
  const site=read('app/loc/scope-data.js');
  assert.match(site,/PUBLISHED_SITE_BOOTSTRAP/);
  assert.match(site,/loadPublishedBlocks\(id,pageName\)/);
  assert.doesNotMatch(read('scripts/build-static-export.mjs'),/NEXT_PUBLIC_LOC_ISR_ORIGIN/);
});

test('Culture, Statistics and LOC aggregates never fetch full articles when Kysely fails',async()=>{
  const code=read('app/loc/galaxy-query.js');
  assert.doesNotMatch(code,/missingStatisticsRpc|statisticsRpcInstalled/);
  assert.doesNotMatch(code,/const registry=await selectScopeRegistry/);
  const begin=code.indexOf('async function selectScopeOverviewRaw(');
  const end=code.indexOf('// Separate source and media breakdowns.',begin);
  assert.ok(begin>=0&&end>begin);
  const counts={overview:0,earliest:0,loc:0};
  const handlers=new Function('scopeOf','usesNumericIsr','readNumericIsr',
    'readScopeOverview','readScopeEarliest','readLocStatistics',code.slice(begin,end)+
    '\nreturn {selectScopeOverviewRaw,selectScopeEarliestRaw,selectLocStatisticsRaw};')(
      scope=>({id:scope.id||scope}),()=>false,()=>{throw Error('ISR disabled');},
      async()=>{counts.overview++;return {rows:[]};},
      async()=>{counts.earliest++;return '2026-01-01';},
      async()=>{counts.loc++;return {scopes:[],rows:[]};});
  assert.deepEqual(await handlers.selectScopeOverviewRaw({id:'lo3rwang'}),{rows:[]});
  assert.equal(await handlers.selectScopeEarliestRaw({id:'lo3rwang'}),'2026-01-01');
  assert.deepEqual(await handlers.selectLocStatisticsRaw(),{scopes:[],rows:[]});
  assert.deepEqual(counts,{overview:1,earliest:1,loc:1});
  // Unavailable aggregates propagate the error; no legacy full-row work is started.
  const broken=new Function('scopeOf','usesNumericIsr','readNumericIsr',
    'readScopeOverview','readScopeEarliest','readLocStatistics',code.slice(begin,end)+
    '\nreturn selectLocStatisticsRaw;')(
      scope=>({id:scope.id||scope}),()=>false,()=>{},
      async()=>{},async()=>{},async()=>{throw Error('SQL aggregate unavailable');});
  await assert.rejects(broken(),/SQL aggregate unavailable/);
});
