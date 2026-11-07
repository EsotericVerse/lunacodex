import test from 'node:test';
import assert from 'node:assert/strict';
import {validateGatewayUrl,makeReadOnlyProbe,verifyLocSqlGateway}
 from './verify-loc-sql-gateway.mjs';

test('smoke probe refuses credentials, non-TLS and unsupported endpoints',()=>{
 for(const value of ['', 'http://sql.example.org/v1/sql',
  'https://user:password@sql.example.org/v1/sql',
  'https://sql.example.org/v1/sql?token=secret',
  'https://sql.example.org/functions/v1/loc-kysely',
  'https://sql.example.org/rest/v1'])
   assert.throws(()=>validateGatewayUrl(value));
 assert.equal(validateGatewayUrl('https://sql.example.org/v1/sql'),
  'https://sql.example.org/v1/sql');
});
test('probe is one bounded anonymous SELECT and never mutates the database',async()=>{
 const seen=[];
 const result=await verifyLocSqlGateway({url:'https://sql.example.org/v1/sql',
  fetchImpl:async(endpoint,init)=>{
   seen.push({endpoint,init});
   return {ok:true,status:200,json:async()=>({data:[{uid:'aB12cD34',title:'test'}]})};
  }});
 assert.deepEqual(result,{reachable:true,scopeid:'lo3rwang',rows:1,readOnly:true});
 assert.equal(seen.length,1);
 const request=JSON.parse(seen[0].init.body);
 assert.deepEqual(request,makeReadOnlyProbe());
 assert.equal(request.operation,'select');
 assert.ok(request.limit<=1);
 assert.equal(seen[0].init.headers.authorization,undefined);
});
test('probe rejects empty Scope and malformed SQL responses',async()=>{
 assert.throws(()=>makeReadOnlyProbe('lo3rwang;DROP TABLE'),/Invalid LOC Scope/);
 await assert.rejects(verifyLocSqlGateway({url:'https://sql.example.org/v1/sql',
  fetchImpl:async()=>({ok:true,status:200,json:async()=>({data:{uid:1}})})}),
  /array of rows/);
 await assert.rejects(verifyLocSqlGateway({url:'https://sql.example.org/v1/sql',
  fetchImpl:async()=>({ok:false,status:503})}),/HTTP 503/);
});
