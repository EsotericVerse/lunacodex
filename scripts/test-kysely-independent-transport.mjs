import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {getSqlRuntimeCapabilities,portableRelation} from '../app/loc/providers/sql-engine-ports.mjs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('direct Kysely dialect selection remains portable across SQL engines',()=>{
 const driver=read('app/loc/providers/kysely-database-drivers.ts');
 for(const [engine,dialect] of Object.entries({
   postgres:'PostgresDialect',mysql:'MysqlDialect',mssql:'MssqlDialect'
 })){
   assert.equal(getSqlRuntimeCapabilities(engine).dialect,dialect);
   assert.ok(driver.includes(dialect));
 }
 assert.equal(portableRelation('lo3rwang_galaxy','postgres','silver'),'silver.lo3rwang_galaxy');
 assert.equal(portableRelation('lo3rwang_galaxy','mysql'),'lo3rwang_galaxy');
 assert.equal(portableRelation('lo3rwang_galaxy','mssql','dbo'),'dbo.lo3rwang_galaxy');
});

test('the application does not package a generic SQL Gateway',()=>{
 for(const path of ['app/loc/gateway/sql-handler.ts',
   'app/loc/gateway/runtime-database-target.mjs',
   'app/loc/providers/loc-gateway.mjs',
   'app/loc/providers/kysely-edge.mjs'])
   assert.equal(existsSync(new URL('../'+path,import.meta.url)),false,path);
 const browser=read('app/loc/providers/configured.mjs');
 assert.match(browser,/createDirectDataApiClient/);
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
