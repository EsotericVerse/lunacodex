import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeOrdered,readOrdered,orderedBatch} from '../app/loc/mcp/ordered-conversation.mjs';
import {onRequestOptions,onRequest} from '../functions/api/las-native.js';

const url='https://loc.lo3rwang.cc/api/las-native';
const ext='chrome-extension://hiaeafonocnjaclcfgjmdopbcgnafnna';
const a={message_id:'turn-a',role:'user',source_order:0,parent_id:null,text:'開始'};
const b={message_id:'turn-b',role:'assistant',source_order:1,parent_id:'turn-a',text:'回覆'};

test('LOC ordered import sorts by original source_order and preserves IDs',()=>{
 const first=mergeOrdered(null,[b,a]);
 assert.equal(first.added,2);
 assert.deepEqual(readOrdered(first.content).map(x=>x.message_id),['turn-a','turn-b']);
});
test('LOC ordered import retries are idempotent and reject ordinal conflicts',()=>{
 const first=mergeOrdered(null,[a,b]);
 const repeated=mergeOrdered(first.content,[a,b]);
 assert.equal(repeated.added,0);
 assert.equal(repeated.count,2);
 assert.throws(()=>mergeOrdered(first.content,[{...b,message_id:'another'}]),/ordinal/);
 assert.throws(()=>orderedBatch([a,{...a}]),/Duplicate/);
});
test('LOC existing LAS bridge preflight allows only configured Chrome Extension',()=>{
 const allowed=onRequestOptions({request:new Request(url,{method:'OPTIONS',
   headers:{origin:ext,'access-control-request-method':'POST',
    'access-control-request-headers':'authorization,content-type'}})});
 assert.equal(allowed.status,204);
 assert.equal(allowed.headers.get('access-control-allow-origin'),ext);
 assert.match(allowed.headers.get('access-control-allow-headers'),/Authorization/);
 const denied=onRequestOptions({request:new Request(url,{method:'OPTIONS',
   headers:{origin:'https://untrusted.example'}})});
 assert.equal(denied.status,403);
});
test('LOC direct import never grants unauthenticated ordered writes',async()=>{
 const request=new Request(url,{method:'POST',
   headers:{origin:ext,'content-type':'application/json'},
   body:JSON.stringify({kind:'mcp-conversation',action:'record_ordered',
    scopeid:'lo3rwang',conversation_id:'test://no-auth',records:[a]})});
 const response=await onRequest({request,env:{},waitUntil:()=>{}});
 assert.equal(response.status,401);
 assert.equal(response.headers.get('access-control-allow-origin'),ext);
 assert.match((await response.json()).error.message,/bearer token required/i);
});
