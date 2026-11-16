import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const src=readFileSync(new URL('../functions/api/las-native.js',import.meta.url),'utf8');
const native=readFileSync(new URL('../app/loc/mcp/native-operations.mjs',import.meta.url),'utf8');
assert.ok(native.includes("'mcp-authorize'"));
assert.ok(native.includes("'mcp-public-read'"));
assert.ok(native.includes("'mcp-article-stat'"));
const calls=[];
const js=src.replace(/^import \{handleNativeLocOperation\} from .*?;\s*$/m,'')
 .replace('export function onRequest','function onRequest')+'\nthis.onRequest=onRequest;';
const sandbox={URL,Headers,Request,Response,handleNativeLocOperation:async (r,env)=>{
  calls.push({url:r.url,headers:r.headers,body:await r.text(),env});
  return new Response('verified by LOC native handler',{status:200});
}};
vm.runInNewContext(js,sandbox,{filename:'las-native.js'});
test('LAS service rejects unrelated hostname and methods',async()=>{
  const nonLoc=await sandbox.onRequest({request:new Request('https://other.example/api/las-native',{method:'POST'}),env:{}});
  assert.equal(nonLoc.status,404);
  const get=await sandbox.onRequest({request:new Request('https://loc.lo3rwang.cc/api/las-native'),env:{}});
  assert.equal(get.status,405);
  assert.equal(calls.length,0);
});
test('LAS bridge forwards only to original MCP verified backend without website session cookies',async()=>{
  const request=new Request('https://loc.lo3rwang.cc/api/las-native',{
    method:'POST',headers:{Authorization:'Bearer verified',Cookie:'session=do-not-forward',
      'Content-Type':'application/json'},body:JSON.stringify({kind:'mcp-authorize',scopeid:'lo3rwang'})
  });
  const res=await sandbox.onRequest({request,env:{key:'value'}});
  assert.equal(res.status,200);
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'https://mcp.lo3rwang.cc/api/loc-native');
  assert.equal(calls[0].headers.get('Authorization'),'Bearer verified');
  assert.equal(calls[0].headers.has('Cookie'),false);
  assert.equal(JSON.parse(calls[0].body).kind,'mcp-authorize');
});
test('business service continues to enforce legacy reader and OAuth scopes',()=>{
  assert.ok(native.includes('loadMcpLocAccess'));
  assert.ok(native.includes("audience:'https://'+MCP_HOST"));
  assert.ok(native.includes("String(claims.scope||'')"));
  assert.ok(native.includes("return reply({data:{authorized:true}})"));
});
