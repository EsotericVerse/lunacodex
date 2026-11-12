import test from 'node:test';
import assert from 'node:assert/strict';
import {readBoundedJson,readBoundedText,BodyTooLargeError}
  from '../app/loc/mcp/stream-json.mjs';
import {parseUpstreamReply} from '../app/loc/mcp/upstream-tools.mjs';

const bytes=value=>new TextEncoder().encode(value);
const stream=parts=>new ReadableStream({
  start(controller){for(const part of parts)controller.enqueue(part);controller.close()}
});
const response=(parts,mime='application/json')=>
  new Response(stream(parts),{headers:{'content-type':mime}});

test('Gateway stream parser preserves UTF-8 across chunks and returns one JSON root',async()=>{
 const data=bytes(JSON.stringify({jsonrpc:'2.0',message:'月典',items:[1,2,3]}));
 const parsed=await readBoundedJson(stream([data.subarray(0,25),data.subarray(25,26),
   data.subarray(26)]),data.length);
 assert.equal(parsed.message,'月典');
 assert.deepEqual(parsed.items,[1,2,3]);
});
test('Gateway bounds the actual request bytes, not only Content-Length',async()=>{
 await assert.rejects(readBoundedJson(stream([bytes('{"a":"'),
  bytes('x'.repeat(100)),bytes('"}')]),50),BodyTooLargeError);
 await assert.rejects(readBoundedJson(stream([bytes('{"a":')]),100),SyntaxError);
 await assert.rejects(readBoundedJson(stream([]),100),SyntaxError);
});
test('Gateway bounded text decoder preserves multi-byte SSE characters',async()=>{
 const data=bytes('data: 月典\n\n');
 const text=await readBoundedText(stream([data.subarray(0,7),data.subarray(7,8),
  data.subarray(8)]),100);
 assert.equal(text,'data: 月典\n\n');
});
test('upstream JSON-RPC replies use the same bounded streaming transport',async()=>{
 const data=bytes(JSON.stringify({jsonrpc:'2.0',id:9,result:{ok:true}}));
 const answer=await parseUpstreamReply(response([data.subarray(0,8),data.subarray(8)]),9);
 assert.deepEqual(answer.result,{ok:true});
 await assert.rejects(parseUpstreamReply(response([data]),10),/response ID/);
 await assert.rejects(parseUpstreamReply(response([
  bytes(JSON.stringify({jsonrpc:'2.0',id:9}))
 ]),9),/response ID/);
 await assert.rejects(parseUpstreamReply(response([bytes('x'.repeat(300001))]),9),
  BodyTooLargeError);
});
test('upstream SSE ignores progress and selects exact request ID',async()=>{
 const s='event: message\n'+
   'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{}}\n\n'+
   'data: {"jsonrpc":"2.0","id":1,"result":{"from":"other"}}\n\n'+
   'data: {"jsonrpc":"2.0","id":9,"result":{"from":"match"}}\n\n';
 const answer=await parseUpstreamReply(response([bytes(s.slice(0,56)),bytes(s.slice(56))],
  'text/event-stream'),9);
 assert.equal(answer.result.from,'match');
 await assert.rejects(parseUpstreamReply(response([bytes(
  'data: {"jsonrpc":"2.0","id":9,"result":null,"error":{"code":"bad","message":"x"}}\n\n'
 )],'text/event-stream'),9),/Invalid upstream/);
});
