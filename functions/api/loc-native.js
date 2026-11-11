import {handleNativeLocOperation} from '../../app/loc/mcp/native-operations.mjs';

// LOC data service, separate from LOC Auth. CORS is deliberately limited to
// the existing extension and the LOC website; no browser may pass SQL directly.
const EXTENSION='chrome-extension://hiaeafonocnjaclcfgjmdopbcgnafnna';
const WEB='https://loc.lo3rwang.cc';
const ORIGINS=new Set([EXTENSION,WEB]);
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
  const origin=request.headers.get('origin');
  if(origin&&!ORIGINS.has(origin))return new Response(null,{status:403});
  return cors(request,new Response(null,{status:204}));
}
export async function onRequest(context){
  if(context.request.method==='OPTIONS')
    return onRequestOptions(context);
  const response=await handleNativeLocOperation(context.request,context.env);
  return cors(context.request,response);
}
