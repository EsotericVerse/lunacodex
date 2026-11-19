// LAS -> LOC fixed-operation bridge. LOC owns Galaxy operations and the
// existing Scope/api.manage policy; LAS supplies a signed MCP-audience bearer.
// Keep the original request/body stream intact: Cloudflare Pages owns the
// incoming stream, and constructing a second Request can fail before the
// native handler has a chance to return an authenticated error.
import {handleNativeLocOperation} from '../../app/loc/mcp/native-operations.mjs';

const HOST='loc.lo3rwang.cc';

export async function onRequest({request,env,waitUntil}){
  if(new URL(request.url).hostname!==HOST)
    return new Response('Not found',{status:404});
  if(request.method!=='POST')
    return new Response('Method not allowed',{status:405,headers:{Allow:'POST'}});
  // Trusted bridge flag exists only inside the Pages Function. It cannot be
  // set by HTTP headers, query parameters, or the JSON request body.
  try{
    return await handleNativeLocOperation(request,env,{
      waitUntil,trustedMcpBridge:true
    });
  }catch(error){
    // Keep fatal bridge failures structured. Never leak tokens, SQL, URLs,
    // request bodies or provider error messages to clients or logs.
    console.error('[LOC LAS bridge]',{
      stage:'unhandled',name:String(error?.name||'Error').slice(0,40)
    });
    return new Response(JSON.stringify({error:{
      code:'LOC_LAS_BRIDGE_UNAVAILABLE',message:'LOC business bridge unavailable'
    }}),{status:503,headers:{
      'content-type':'application/json; charset=utf-8',
      'cache-control':'no-store'
    }});
  }
}
