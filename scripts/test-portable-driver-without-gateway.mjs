import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {getSqlRuntimeCapabilities,portableRelation} from '../app/loc/providers/sql-engine-ports.mjs';
import {publicNumericSources} from '../app/api/loc/_server.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('LOC never packages a standalone SQL Gateway runtime',()=>{
 for(const path of [
  'Dockerfile','services/loc-sql/main.ts','services/loc-sql/Dockerfile',
  'services/loc-sql/cloudflare-worker.mjs','services/loc-sql/wrangler.jsonc',
  'services/loc-mcp-sql/main.ts','services/loc-mcp-sql/Dockerfile',
  'services/loc-mcp-sql/cloudflare-worker.mjs','services/loc-mcp-sql/wrangler.jsonc'
 ])assert.equal(existsSync(new URL('../'+path,import.meta.url)),false,path);
 const configured=read('app/loc/providers/configured.mjs');
 const server=read('app/api/loc/_server.js');
 assert.doesNotMatch(configured,/createLocGatewayAdapter|NEXT_PUBLIC_LOC_SQL_GATEWAY_URL/);
 assert.doesNotMatch(server,/createKyselyEdgeClient|LOC_SQL_GATEWAY_URL/);
});

test('Kysely keeps SQL engine dialects and independent physical namespaces',()=>{
 const required={
  postgres:'PostgresDialect',mysql:'MysqlDialect',mssql:'MssqlDialect'
 };
 const driver=read('app/loc/mcp/native-kysely.mjs');
 for(const [engine,dialect] of Object.entries(required)){
  assert.equal(getSqlRuntimeCapabilities(engine).dialect,dialect);
  assert.match(driver,new RegExp(dialect));
 }
 assert.equal(portableRelation('lo3rwang_galaxy','mysql'),'lo3rwang_galaxy');
 assert.equal(portableRelation('lo3rwang_galaxy','postgres','silver'),'silver.lo3rwang_galaxy');
 assert.equal(portableRelation('lo3rwang_galaxy','mssql','dbo'),'dbo.lo3rwang_galaxy');
});

test('public reads use LOC Pages Kysely, not a vendor REST API',async()=>{
 const calls=[];
 const sources=publicNumericSources({
  fetchImpl:async(url,options)=>{
   calls.push({url:String(url),options});
   return Response.json({data:[{uid:'Ab12Cd34'}]});
  }
 });
 assert.deepEqual(sources.map(x=>x.id),['primary']);
 const result=await sources[0].schema().from('lo3rwang_galaxy').select('uid')
  .eq('uid','Ab12Cd34').limit(1);
 assert.equal(result.data[0].uid,'Ab12Cd34');
 assert.equal(calls.length,1);
 assert.equal(calls[0].url,'https://loc.lo3rwang.cc/api/loc-public-query');
 assert.ok(!calls[0].url.includes('/rest/v1'));
});
