import test from 'node:test';
import assert from 'node:assert/strict';
import {handleStatelessMcpPost} from '../app/loc/mcp/stateless-transport.mjs';
import {scopedZModelSchema} from '../zenstack/scoped-schema.mjs';

const endpoint='https://mcp.lo3rwang.cc/mcp';
function req(body){
  return new Request(endpoint,{method:'POST',headers:{'content-type':'application/json'},
    body:typeof body==='string'?body:JSON.stringify(body)});
}
const call=(id=1)=>({jsonrpc:'2.0',id,method:'ping',params:{}});
const dispatch=async msg=>Response.json({jsonrpc:'2.0',id:msg.id,result:{called:msg.method}});
test('ported WebMCP stateless transport invokes only one valid JSON-RPC request',async()=>{
  const result=await handleStatelessMcpPost(req(call(17)),dispatch);
  assert.equal(result.status,200);
  assert.deepEqual(await result.json(),{jsonrpc:'2.0',id:17,result:{called:'ping'}});
  const legacy=await handleStatelessMcpPost(req([call(18)]),dispatch);
  assert.equal((await legacy.json()).id,18);
});
test('ported MCP transport refuses multi-message batches without executing tools',async()=>{
  let invoked=0;
  const denied=await handleStatelessMcpPost(req([call(1),call(2)]),()=>{
    invoked++;return Response.json({});
  });
  assert.equal((await denied.json()).error.code,-32600);
  assert.equal(invoked,0);
});
test('MCP notifications receive 202 and cannot trigger tool execution',async()=>{
  let invoked=0;
  const ack=await handleStatelessMcpPost(req({jsonrpc:'2.0',method:'notifications/initialized'}),()=>{
    invoked++;return Response.json({});
  });
  assert.equal(ack.status,202);
  assert.equal(await ack.text(),'');
  assert.equal(invoked,0);
});
test('invalid envelopes and malformed/oversized JSON never reach Galaxy',async()=>{
  let invoked=0;
  const never=()=>{invoked++;return Response.json({})};
  let bad=await handleStatelessMcpPost(req('{'),never);
  assert.equal(bad.status,400);
  assert.equal((await bad.json()).error.code,-32700);
  bad=await handleStatelessMcpPost(req({jsonrpc:'1.0',id:1,method:'ping'}),never);
  assert.equal(bad.status,400);
  assert.equal((await bad.json()).error.code,-32600);
  bad=await handleStatelessMcpPost(req({jsonrpc:'2.0',id:1,
    method:'tools/call',params:{blob:'x'.repeat(710000)}}),never);
  assert.equal(bad.status,413);
  assert.equal(invoked,0);
});
test('MCP Galaxy relation comes from the frozen scoped ZModel',()=>{
  const model=scopedZModelSchema({scopeId:'lo3rwang',namespace:'silver'}).models.Galaxy;
  const path=model.attributes.find(x=>x.name==='@@map')?.args[0]?.value?.value;
  assert.equal(path,'lo3rwang_galaxy');
  assert.ok(model.fields.uid);
  assert.ok(model.fields.content);
  assert.ok(model.fields.site);
  assert.throws(()=>scopedZModelSchema({scopeId:'bad_scope'}),/Invalid/);
});
