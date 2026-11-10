import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('LOC browser login uses native OAuth and never selects a standalone SQL gateway',()=>{
  const account=read('app/loc/auth/loc-browser.mjs');
  const configured=read('app/loc/providers/configured.mjs');
  assert.match(account,/createLocAccountAdapter/);
  assert.match(account,/\/v1\/auth\/session/);
  assert.match(configured,/createLocAccountAdapter/);
  assert.doesNotMatch(configured,/createLocGatewayAdapter|NEXT_PUBLIC_LOC_SQL_GATEWAY_URL/);
  assert.doesNotMatch(configured,/frontendApiUrl|createClient\(/);
});

test('Kysely engine drivers stay portable without a standalone gateway',()=>{
  const driver=read('app/loc/mcp/native-kysely.mjs');
  assert.ok(driver.includes('PostgresDialect'));
  for(const removed of ['MysqlDialect','MssqlDialect'])
    assert.equal(driver.includes(removed),false,removed);
  assert.match(driver,/LOC_DB_PROFILE_SERVICE_TOKEN/);
  assert.match(driver,/normalizeLiveTarget/);
  assert.doesNotMatch(driver,/process\.env\.NEXT_PUBLIC/);
});

test('website extension bridge cannot forward a website bearer token',()=>{
  const path='public/extension/website-bridge.mjs';
  assert.equal(existsSync(new URL('../'+path,import.meta.url)),true);
  const source=read(path);
  assert.doesNotMatch(source,/getToken|authorization:|sendMessage/);
  assert.match(source,/auth\.lo3rwang\.cc/);
});

test('retired SQL Gateway implementation cannot be reintroduced',()=>{
  for(const path of [
    'app/loc/gateway/sql-handler.ts',
    'app/loc/gateway/runtime-database-target.mjs',
    'app/loc/gateway/edge-runtime-compat.mjs',
    'app/loc/providers/loc-gateway.mjs',
    'app/loc/providers/kysely-edge.mjs',
    'services/loc-sql/main.ts','services/loc-mcp-sql/main.ts'
  ])assert.equal(existsSync(new URL('../'+path,import.meta.url)),false,path);
  const fixedReceiver=read('app/loc/import/channel1-receiver.ts');
  assert.match(fixedReceiver,/Kysely,PostgresDialect/);
  assert.doesNotMatch(read('services/loc-channel1/main.ts'),/app\/loc\/gateway/);
});

test('package and npm lockfile cannot restore Supabase or Clerk SDK',async()=>{
  const {checkProhibitedVendorDependencies}=await import('./check-db-contract.mjs');
  const pkg=read('package.json'),lock=read('package-lock.json');
  assert.deepEqual(checkProhibitedVendorDependencies(pkg,lock),{declared:0,installed:0});
  const fake=JSON.stringify({dependencies:{'@supabase/supabase-js':'2.0.0'}});
  assert.throws(()=>checkProhibitedVendorDependencies(fake,lock),/Forbidden vendor/);
  const fakeLock=JSON.stringify({packages:{'node_modules/@clerk/nextjs':{version:'1.0.0'}}});
  assert.throws(()=>checkProhibitedVendorDependencies(pkg,fakeLock),/Forbidden vendor/);
});
