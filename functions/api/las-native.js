// LAS -> LOC fixed-operation bridge. LOC owns Galaxy operations and the
// existing Scope/api.manage policy; LAS supplies a signed MCP-audience bearer.
// Keep the original request/body stream intact: Cloudflare Pages owns the
// incoming stream, and constructing a second Request can fail before the
// native handler has a chance to return an authenticated error.
import {handleNativeLocOperation} from '../../app/loc/mcp/native-operations.mjs';

const HOST='loc.lo3rwang.cc';

export function onRequest({request,env,waitUntil}){
  if(new URL(request.url).hostname!==HOST)
    return new Response('Not found',{status:404});
  if(request.method!=='POST')
    return new Response('Method not allowed',{status:405,headers:{Allow:'POST'}});
  // Trusted bridge flag exists only inside the Pages Function. It cannot be
  // set by HTTP headers, query parameters, or the JSON request body.
  return handleNativeLocOperation(request,env,{
    waitUntil,trustedMcpBridge:true
  });
}
