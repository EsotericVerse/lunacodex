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
  const driver=read('app/loc/providers/kysely-database-drivers.ts');
  for(const dialect of ['PostgresDialect','MysqlDialect','MssqlDialect'])
    assert.ok(driver.includes(dialect),dialect);
  assert.match(driver,/LOC_DB_CONNECTIONS_JSON/);
  assert.doesNotMatch(driver,/process\.env\.NEXT_PUBLIC/);
});

test('website extension bridge cannot forward a website bearer token',()=>{
  const path='public/extension/website-bridge.mjs';
  assert.equal(existsSync(new URL('../'+path,import.meta.url)),true);
  const source=read(path);
  assert.doesNotMatch(source,/getToken|authorization:|sendMessage/);
  assert.match(source,/auth\.lo3rwang\.cc/);
});
