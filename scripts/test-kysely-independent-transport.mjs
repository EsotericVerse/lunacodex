import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {getSqlRuntimeCapabilities,portableRelation} from '../app/loc/providers/sql-engine-ports.mjs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('direct Kysely dialect selection remains portable across SQL engines',()=>{
 const driver=read('app/loc/mcp/native-kysely.mjs');
 assert.equal(getSqlRuntimeCapabilities('postgres').dialect,'PostgresDialect');
 assert.ok(driver.includes('PostgresDialect'));
 assert.equal(portableRelation('lo3rwang_galaxy','postgres','silver'),
  'silver.lo3rwang_galaxy');
 for(const disabled of ['mysql','mssql']){
  assert.throws(()=>getSqlRuntimeCapabilities(disabled),/Unsupported SQL engine/);
  assert.throws(()=>portableRelation('lo3rwang_galaxy',disabled),
   /Unsupported SQL engine/);
 }
});

test('the application does not package a generic SQL Gateway',()=>{
 assert.equal(existsSync(new URL('../app/loc/providers/kysely-database-drivers.ts',import.meta.url)),false,
  'Retired standalone Deno driver must not be reintroduced');
 for(const path of ['app/loc/gateway/sql-handler.ts',
   'app/loc/gateway/runtime-database-target.mjs',
   'app/loc/providers/loc-gateway.mjs',
   'app/loc/providers/kysely-edge.mjs'])
   assert.equal(existsSync(new URL('../'+path,import.meta.url)),false,path);
 const browser=read('app/loc/providers/configured.mjs');
 assert.match(browser,/createKyselyPublicClient/);
 assert.doesNotMatch(browser,/createDirectDataApiClient|rest[/]v1/);
 assert.doesNotMatch(browser,/createKyselyEdgeClient|createLocGatewayAdapter/);
});

test('MCP and short imports execute fixed native Kysely operations',()=>{
 const native=read('app/loc/mcp/native-operations.mjs');
 const driver=read('app/loc/mcp/native-kysely.mjs');
 assert.match(native,/executePortableMcp/);
 assert.match(native,/authorizeDelegatedShortImport/);
 assert.match(native,/verifyDelegationBoundary/);
 assert.match(driver,/PostgresDialect/);
 assert.match(read('functions/api/loc-native.js'),/handleNativeLocOperation/);
});
