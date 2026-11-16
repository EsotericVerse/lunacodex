// LAS -> LOC fixed-operation bridge. LOC remains owner of Galaxy business
// queries, existing Scope permissions, and SQL dialects. No SQL ingress.
// The host rewrite selects the existing MCP-audience OAuth verification
// path of the LOC native handler; the original website route stays unchanged.
import {handleNativeLocOperation} from '../../app/loc/mcp/native-operations.mjs';

const HOST='loc.lo3rwang.cc';
const RESOURCE='https://mcp.lo3rwang.cc/api/loc-native';

export function onRequest({request,env}){
  if(new URL(request.url).hostname!==HOST)
    return new Response('Not found',{status:404});
  if(request.method!=='POST')
    return new Response('Method not allowed',{status:405,headers:{Allow:'POST'}});
  // Never use website cookies for MCP. The LOC handler verifies the original
  // MCP OAuth bearer audience + UserInfo and independently checks api.manage.
  const headers=new Headers();
  // This is a fixed authenticated operation channel, not a general-purpose
  // HTTP proxy. Never copy browser cookies, Host or forwarding headers.
  for(const key of ['authorization','content-type','accept'])
    if(request.headers.has(key))
      headers.set(key,request.headers.get(key));
  const delegated=new Request(RESOURCE,{
    method:'POST',headers,body:request.body,duplex:'half',
    redirect:'error'
  });
  return handleNativeLocOperation(delegated,env);
}
