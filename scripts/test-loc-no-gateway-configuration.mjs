import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {authorityAction} from '../app/loc/mcp/authority-client.mjs';
import {TOOLS} from '../app/loc/mcp/router.mjs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const OAuth='eyJ.fake.body.signature';

test('MCP scope_storage is read-only and never accepts Gateway URL or secrets',async()=>{
 const tool=TOOLS.find(x=>x.name==='scope_storage');
 assert.deepEqual(Object.keys(tool.inputSchema.properties),['scopeid']);
 assert.equal(tool.annotations.readOnlyHint,true);
 let requests=0;
 const fetcher=async(url,options)=>{
  requests++;
  assert.equal(url,'https://auth.lo3rwang.cc/v1/mcp/scope/lo3rwang');
  assert.equal(options.method,'GET');
  return Response.json({scopeid:'lo3rwang',configured:false,needs_native_driver:true});
 };
 for(const fields of [
   {endpoint:'https://sql.example.org/v1/sql'},
   {schema:'silver'},{table:'lo3rwang_galaxy'},
   {database_url:'postgresql://test:secret@sql.example.org/db'}
 ]){
  await assert.rejects(authorityAction('scope_storage',
   {scopeid:'lo3rwang',...fields},OAuth,{},fetcher),/Gateway registration/);
 }
 assert.equal(requests,0);
 const status=await authorityAction('scope_storage',{scopeid:'lo3rwang'},OAuth,{},fetcher);
 assert.equal(requests,1);
 assert.equal(status.scopeid,'lo3rwang');
});
test('LOC Auth has no SQL Gateway runtime-profile service or writer',()=>{
 const worker=read('workers/loc-authority/index.mjs');
 assert.doesNotMatch(worker,/trustedSqlProfile|\/v1\/sql\/runtime-profile|async putMcpScope\(/);
 assert.match(worker,/if\(request\.method==='PUT'\)throw fail\('SQL Gateway Scope registration is retired',410\)/);
 assert.match(worker,/legacy_gateway_retired:true/);
 assert.doesNotMatch(worker,/return \{\.\.\.item\.public,configured:/);
 assert.equal(existsSync(new URL('../workers/loc-authority/sql-profile.mjs',import.meta.url)),false);
});
