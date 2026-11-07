import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('LOC native identity owns every active browser SQL adapter',()=>{
  const account=read('app/loc/auth/loc-browser.mjs');
  const configured=read('app/loc/providers/configured.mjs');
  const sql=read('app/loc/providers/kysely-edge.mjs');
  assert.match(account,/createLocAccountAdapter/);
  assert.match(account,/\/v1\/auth\/session/);
  assert.match(configured,/createLocAccountAdapter/);
  assert.match(configured,/NEXT_PUBLIC_LOC_SQL_GATEWAY_URL/);
  assert.match(sql,/LOC SQL Gateway is not configured/);
  assert.doesNotMatch(configured,/publishableKey|frontendApiUrl/);
});

test('SQL Gateway drivers remain portable',()=>{
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
