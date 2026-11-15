import {SCOPE_ROUTE_INDEX} from '../../modular/routing/scope-route-index';

// The same generated public route index drives browser navigation and CORS.
// Published GET data are public, but the protected POST still authenticates
// the caller independently of the Origin and never accepts credentials by CORS.
const PUBLIC_WEB_ORIGINS=new Set([
  'https://esotericverse.github.io',
  ...SCOPE_ROUTE_INDEX.filter(row=>row.active!==false&&row.domain)
    .map(row=>'https://'+row.domain)
]);

export function withLocCors(response,request,{methods='GET, OPTIONS'}={}){
  const origin=request.headers.get('origin');
  if(!origin||!PUBLIC_WEB_ORIGINS.has(origin))return response;
  response.headers.set('Access-Control-Allow-Origin',origin);
  response.headers.set('Vary','Origin');
  response.headers.set('Access-Control-Allow-Methods',methods);
  response.headers.set('Access-Control-Allow-Headers','Authorization, Content-Type');
  response.headers.set('Access-Control-Max-Age','86400');
  return response;
}

export function locCorsPreflight(request,options={}){
  const origin=request.headers.get('origin');
  if(!origin||!PUBLIC_WEB_ORIGINS.has(origin))
    return new Response(null,{status:403});
  return withLocCors(new Response(null,{status:204}),request,options);
}
