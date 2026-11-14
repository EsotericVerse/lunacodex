// Validate the existing POST SSE implementation without an Auth service or DB.
// Use Node 22's native web streams; never open an external connection.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const path=new URL('../app/loc/mcp/stateless-transport.mjs',import.meta.url);
const source=readFileSync(path,'utf8')
  .replace(/^import .*;$/gm,'').replace(/^export /gm,'');
const context={ReadableStream,Response,TextEncoder};
runInNewContext(source+'\nglobalThis.testStream=streamMcpSseResponse;',context,
 {timeout:3000});
const stream=context.testStream;
assert.equal(typeof stream,'function');

function finalRpc(body){
 const chunks=body.split(/\r?\n\r?\n/).filter(chunk=>chunk.includes('data:'));
 assert(chunks.length>0,'SSE must include a JSON-RPC data event');
 const encoded=chunks.at(-1).split(/\r?\n/).filter(line=>line.startsWith('data:'))
   .map(line=>line.slice(5).trimStart()).join('\n');
 return JSON.parse(encoded);
}
for(const id of [27,'tool-call-7']){
 const response=stream(()=>Promise.reject(new Error('simulated tool failure')),id);
 assert.equal(response.status,200);
 assert.match(response.headers.get('content-type'),/text\/event-stream/);
 const event=finalRpc(await response.text());
 assert.equal(event.jsonrpc,'2.0');
 assert.equal(event.id,id,'SSE must preserve the original JSON-RPC id');
 assert.equal(event.error.code,-32603);
}
const result={jsonrpc:'2.0',id:91,result:{ok:true}};
const ok=stream(()=>new Response(JSON.stringify(result)),result.id);
assert.deepEqual(finalRpc(await ok.text()),result);
console.log('PASS MCP POST SSE preserves request ID on success and failure (no Auth/DB)');
