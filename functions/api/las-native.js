// Existing LOC ordered-conversation import bridge. LAS Extension calls this
// Pages endpoint directly; LOC retains JWT, UserInfo, Scope and api.manage
// validation, idempotent message merge and SQL ownership.
import {handleNativeLocOperation} from '../../app/loc/mcp/native-operations.mjs';

const HOST='loc.lo3rwang.cc';
const EXTENSION='chrome-extension://hiaeafonocnjaclcfgjmdopbcgnafnna';
const ORIGINS=new Set([EXTENSION]);
function cors(request,response){
  const origin=request.headers.get('origin');
  if(!origin||!ORIGINS.has(origin))return response;
  const headers=new Headers(response.headers);
  headers.set('access-control-allow-origin',origin);
  headers.set('vary','Origin');
  headers.set('access-control-allow-methods','POST, OPTIONS');
  headers.set('access-control-allow-headers','Authorization, Content-Type');
  headers.set('access-control-max-age','600');
  return new Response(response.body,{status:response.status,headers});
}
export function onRequestOptions({request}){
  if(new URL(request.url).hostname!==HOST)return new Response('Not found',{status:404});
  const origin=request.headers.get('origin');
  if(origin&&!ORIGINS.has(origin))return new Response(null,{status:403});
  return cors(request,new Response(null,{status:204}));
}
export async function onRequest({request,env,waitUntil}){
  if(new URL(request.url).hostname!==HOST)
    return new Response('Not found',{status:404});
  if(request.method==='OPTIONS')return onRequestOptions({request});
  if(request.method!=='POST')
    return new Response('Method not allowed',{status:405,headers:{Allow:'POST'}});
  const origin=request.headers.get('origin');
  if(origin&&!ORIGINS.has(origin))return new Response(null,{status:403});
  // trustedMcpBridge is a server-only option; no client-controlled header,
  // JSON field or URL is allowed to grant this capability.
  try{
    const response=await handleNativeLocOperation(request,env,{
      waitUntil,trustedMcpBridge:true
    });
    return cors(request,response);
  }catch(error){
    console.error('[LOC LAS bridge]',{
      stage:'unhandled',name:String(error?.name||'Error').slice(0,40)
    });
    return cors(request,new Response(JSON.stringify({error:{
      code:'LOC_LAS_BRIDGE_UNAVAILABLE',message:'LOC business bridge unavailable'
    }}),{status:503,headers:{
      'content-type':'application/json; charset=utf-8',
      'cache-control':'no-store'
    }}));
  }
}
