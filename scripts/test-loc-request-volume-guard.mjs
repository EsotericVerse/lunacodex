import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');

test('keyword writes use one server-authorized request without permission preflight',()=>{
  const browser=read('app/loc/keyword-service-client.mjs');
  const server=read('functions/api/keywords.js');
  assert.doesNotMatch(browser,/locDelegation\(/);
  assert.doesNotMatch(browser,/fetch\('\/api\/loc-permissions'/);
  assert.match(browser,/fetch\('\/api\/keywords'/);
  assert.match(server,/verifiedIdentity\(request,context\.env\)/);
  assert.match(server,/locPermissionsForEmail\(db,claims\.email\)/);
  assert.match(server,/if\(!owner\)error\('Scope Keyword management permission required',403\)/);
});

test('browser verified session deduplicates consumers and never polls',()=>{
  const auth=read('app/loc/auth/loc-browser.mjs');
  assert.match(auth,/let verifiedSessionPromise=null/);
  assert.match(auth,/if\(!verifiedSessionPromise\)/);
  assert.match(auth,/verifiedSessionPromise=pending/);
  assert.doesNotMatch(auth,/setInterval\(|setTimeout\(/);
});

test('LOC UI resource state has no TanStack/SWR polling or retry',()=>{
  const resources=read('zenstack/client-queries.js');
  const shell=read('app/AppShell.jsx');
  const dependencies=read('package.json');
  assert.match(resources,/export class LocResourceStore/);
  assert.match(shell,/LocResourceProvider/);
  assert.doesNotMatch(resources+shell+dependencies,/@tanstack\/react-query|from ['"]swr['"]/);
  assert.doesNotMatch(resources,/setInterval\(|refetchOnMount|refetchInterval|retryDelay/);
  assert.match(resources,/invalidateQueries\(options=\{\}\)/);
  assert.match(resources,/if\(!enabled|if\(enabled&&/);
});
test('Save reuses verified Session and never disables Better Auth cookie cache',()=>{
  const adapter=read('app/loc/providers/configured.mjs');
  const website=read('app/loc/auth/verified-session.mjs');
  const native=read('app/loc/mcp/native-operations.mjs');
  assert.doesNotMatch(adapter,/getVerifiedSession\(\)/);
  assert.match(website,/get-session'/);
  assert.doesNotMatch(website+native,/disableCookieCache/);
  assert.match(native,/verifiedLocWebsiteSession\(request,\{fetchImpl\}\)/);
  assert.match(native,/locPermissionsForEmail\(selected.db,claims.email\)/);
});
test('Neon does not perform automatic connection retries or timed probes',()=>{
  const driver=read('app/loc/mcp/native-kysely.mjs');
  assert.match(driver,/NEON_CONNECTION_COOLDOWN_MS=5\*60\*1000/);
  assert.doesNotMatch(driver,/attempts=2|delayMs=400|setInterval\(/);
  assert.match(driver,/now\(\)<blockedUntil/);
});

test('installed ZenStack Cache attaches only to trusted ORM clients with no background fetching',()=>{
  const model=read('zenstack/client.mjs');
  const packageJson=JSON.parse(read('package.json'));
  assert.equal(packageJson.dependencies['@visualbravo/zenstack-cache'],'^1.0.8');
  assert.equal(packageJson.dependencies['@tanstack/react-query'],undefined);
  assert.match(model,/defineCachePlugin/);
  assert.match(model,/MemoryCacheProvider/);
  assert.match(model,/const provider=new MemoryCacheProvider\(\)/);
  assert.doesNotMatch(model,/RedisCacheProvider|setInterval\(|setTimeout\(|swr:/);
});

test('editing keyboard activity checks are local and coalesced at 15 minutes',()=>{
  const dock=read('app/modular/edit-dock.jsx');
  assert.match(dock,/now-lastActivityCheck<15\*60\*1000/);
  assert.match(dock,/touchEditorSession\(window\.sessionStorage,now\)/);
  assert.doesNotMatch(dock,/setInterval\(/);
});

test('management invalidation marks cached data without issuing refetch',()=>{
  const resources=read('zenstack/client-queries.js');
  assert.match(resources,/invalidateQueries\(options=\{\}\)/);
  assert.match(resources,/invalidateQueries\(options=\{\}\)\{for\(const row of this\.select\(options\)\)this\.update\(row\.queryKey,\{invalidated:true\}\);return Promise\.resolve\(\);\}/);
});

test('Scope group permission display reuses verified grants without HTTP',()=>{
  const panel=read('app/loc/ScopeGroupAccessPanel.jsx');
  assert.match(panel,/readAuthorization\(\)/);
  assert.match(panel,/canAuthorizeGroup\(groupId\)/);
  assert.doesNotMatch(panel,/fetch\(|getSession\(|getVerifiedSession\(/);
  assert.match(panel,/尚未透過編輯入口驗證權限/);
});

test('Scope statistics are event-invalidated, not timer-expired',()=>{
  const statistics=read('app/loc/scope-statistics-cache.mjs');
  const galaxy=read('app/loc/galaxy-query.js');
  assert.match(statistics,/readScopeStatisticsCached/);
  assert.match(statistics,/notifyScopeDataCommitted/);
  assert.doesNotMatch(statistics,/setInterval\(|setTimeout\(/);
  assert.doesNotMatch(galaxy,/STATISTICS_CACHE_TTL_MS/);
});
