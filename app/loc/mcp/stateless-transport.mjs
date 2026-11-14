// Port of WebMCP Anything's stateless MCP HTTP/JSON-RPC handler.
// Original: https://github.com/New1Direction/webmcp-anything/blob/main/worker/src/mcp_server.ts
// License: MIT; see ./WEBMCP-ANYTHING-LICENSE.txt.
// The original URL-extraction engine is intentionally replaced by LOC's
// Zod-advertised MCP tools and its already-authorized Galaxy ZModel backend.
// No auth grants, provider credentials, or SQL operations live in this transport.
import {readBoundedJson,BodyTooLargeError} from './stream-json.mjs';
import {McpRpcSchema} from './tool-contracts.mjs';

// JSON-RPC 2.0 response helpers adapted from the upstream module.
export const rpcResult=(id,value)=>({jsonrpc:'2.0',id,result:value});
export const rpcError=(id,code,message)=>({jsonrpc:'2.0',id:id??null,
  error:{code,message}});

function jsonReply(body,status=200){
  return new Response(JSON.stringify(body),{status,headers:{
    'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store',
    'x-content-type-options':'nosniff',
    'access-control-allow-origin':'*',
    'access-control-allow-headers':'Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id',
    'access-control-allow-methods':'GET, POST, OPTIONS',
    'access-control-expose-headers':'WWW-Authenticate, MCP-Session-Id'
  }});
}
// Pure stateless transport: a single JSON-RPC call/notification per HTTP POST.
// MCP 2025-06-18 removed JSON-RPC batches; accept one legacy array element,
// never silently execute an unsupported multi-message batch.
export async function handleStatelessMcpPost(request,dispatch){
  let message;
  try{message=await readBoundedJson(request.body,700000)}
  catch(error){
    return error instanceof BodyTooLargeError
      ?jsonReply(rpcError(null,-32600,'MCP request too large'),413)
      :jsonReply(rpcError(null,-32700,'Invalid JSON'),400);
  }
  if(Array.isArray(message)){
    if(message.length!==1)
      return jsonReply(rpcError(null,-32600,'Batch requests are not supported'));
    message=message[0];
  }
  const parsed=McpRpcSchema.safeParse(message);
  if(!parsed.success)
    return jsonReply(rpcError(message?.id??null,-32600,'Invalid JSON-RPC request'),400);
  const payload=parsed.data;
  // Match the upstream's 202 acknowledgement; notifications do no work.
  if(payload.id==null)
    return new Response(null,{status:202,headers:{
      'cache-control':'no-store','access-control-allow-origin':'*'
    }});
  return dispatch(payload);
}


/**
 * Streamable HTTP may respond to a POST with either JSON or SSE.
 * Streaming is request-scoped: it carries the same JSON-RPC result, never a
 * second authorization channel, a separate GET endpoint, or a session store.
 * The callback is called only after the Gateway has verified the MCP role.
 */
export function streamMcpSseResponse(execute,requestId=null){
  const encoder=new TextEncoder();
  let canceled=false;
  const stream=new ReadableStream({
    start(controller){
      // Open the response immediately; future progress messages can be emitted
      // before the final JSON-RPC event without changing the route contract.
      controller.enqueue(encoder.encode(': loc-mcp stream opened\n\n'));
      Promise.resolve().then(execute).then(async reply=>{
        const data=await reply.text();
        if(canceled)return;
        if(data)controller.enqueue(encoder.encode('data: '+data.replace(/\n/g,'\ndata: ')+'\n\n'));
        controller.close();
      }).catch(()=>{
        if(canceled)return;
        controller.enqueue(encoder.encode('data: '+JSON.stringify(
          rpcError(requestId,-32603,'LOC MCP operation unavailable'))+'\n\n'));
        controller.close();
      });
    },
    cancel(){canceled=true;}
  });
  return new Response(stream,{status:200,headers:{
    'content-type':'text/event-stream; charset=utf-8',
    'cache-control':'no-cache, no-transform',
    'x-content-type-options':'nosniff',
    'x-accel-buffering':'no',
    'access-control-allow-origin':'*',
    'access-control-allow-headers':'Authorization, Content-Type, Accept, MCP-Protocol-Version, MCP-Session-Id',
    'access-control-allow-methods':'GET, POST, OPTIONS'
  }});
}
