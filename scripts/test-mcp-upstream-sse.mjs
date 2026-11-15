// Regression: a compliant MCP server can keep POST SSE open after its JSON-RPC reply.
import assert from 'node:assert/strict';
import {readUpstreamSseReply} from '../app/loc/mcp/upstream-sse.mjs';

const encode=text=>new TextEncoder().encode(text);
const match=(value,id)=>
  value?.jsonrpc==='2.0'&&value.id===id&&
  (value.result!==undefined||value.error!==undefined)?value:null;

let canceled=false;
const persistent=new ReadableStream({
  start(controller){
    controller.enqueue(encode('event: message\r\ndata: {"jsonrpc":"2.0","id":7,"result":{"ok":true}}\r\n\r\n'));
  },
  cancel(){canceled=true}
});
assert.deepEqual(await readUpstreamSseReply(persistent,7,match),
  {jsonrpc:'2.0',id:7,result:{ok:true}});
await Promise.resolve();
assert.equal(canceled,true,'stop reading once the matching event arrives');

const split=new ReadableStream({
  start(controller){
    controller.enqueue(encode(': keep-alive\n\nevent: progress\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\n\n'));
    controller.enqueue(encode('data: {"jsonrpc":"2.0","id":98,"result":{}}\n\n'));
    const bytes=encode('data: {"jsonrpc":"2.0","id":"x","result":{"title":"漢字"}}\n\n');
    const pos=bytes.indexOf(230);
    controller.enqueue(bytes.slice(0,pos+1));
    controller.enqueue(bytes.slice(pos+1));
  }
});
assert.deepEqual(await readUpstreamSseReply(split,'x',match),
  {jsonrpc:'2.0',id:'x',result:{title:'漢字'}});

await assert.rejects(readUpstreamSseReply(new ReadableStream({
  start(c){c.enqueue(encode('data: {"jsonrpc":"2.0","id":9,"result":{}}\n\n'));c.close()}
}),10,match),/missing its request ID/);
await assert.rejects(readUpstreamSseReply(new ReadableStream({
  start(c){c.enqueue(encode('data: {"jsonrpc":"2.0","id":11}\n\n'));c.close()}
}),11,match),/Invalid upstream MCP response/);
await assert.rejects(readUpstreamSseReply(new ReadableStream({
  start(c){c.enqueue(encode('data: '+ 'x'.repeat(1024)));c.close()}
}),3,match,128),/exceeds size limit/);

console.log('PASS upstream MCP SSE returns on matching event without waiting for EOF');
