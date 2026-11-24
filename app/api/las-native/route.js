import {handleNativeLocOperation} from '../../loc/mcp/native-operations.mjs';

export const runtime='nodejs';
export const dynamic='force-dynamic';

const EXTENSION='chrome-extension://hiaeafonocnjaclcfgjmdopbcgnafnna';
function cors(request,response){
  if(request.headers.get('origin')!==EXTENSION)return response;
  const headers=new Headers(response.headers);
  headers.set('access-control-allow-origin',EXTENSION);
  headers.set('vary','Origin');
  headers.set('access-control-allow-methods','POST, OPTIONS');
  headers.set('access-control-allow-headers','Authorization, Content-Type');
  headers.set('access-control-max-age','600');
  return new Response(response.body,{status:response.status,headers});
}

export function OPTIONS(request){
  const origin=request.headers.get('origin');
  return origin&&origin!==EXTENSION
    ?new Response(null,{status:403})
    :cors(request,new Response(null,{status:204}));
}

export async function POST(request){
  const origin=request.headers.get('origin');
  if(origin&&origin!==EXTENSION)return new Response(null,{status:403});
  try{
    return cors(request,await handleNativeLocOperation(request,process.env,
      {trustedMcpBridge:true}));
  }catch{
    return cors(request,new Response(JSON.stringify({error:{
      code:'LOC_LAS_BRIDGE_UNAVAILABLE',message:'LOC business bridge unavailable'
    }}),{status:503,headers:{'content-type':'application/json; charset=utf-8',
      'cache-control':'no-store'}}));
  }
}
