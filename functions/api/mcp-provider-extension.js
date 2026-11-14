// Extension-facing upstream MCP SSO control surface.
// LOC Auth OAuth bearer identity is the only browser credential accepted here;
// provider access tokens remain encrypted in the LOC MCP provider vault.
import {z} from 'zod';
import {beginUpstreamOAuth,disconnectUpstream} from '../../app/loc/mcp/upstream-oauth.mjs';
import {providerStatuses,clearToolPolicies} from '../../app/loc/mcp/upstream-policy.mjs';
import {ProviderIdSchema,upstreamProvider} from '../../app/loc/mcp/upstream-providers.mjs';
import {normalizeSsoEmail} from '../../app/loc/mcp/extension-sso.mjs';
import {verifyAccessTokenRequest,requestToResourceInput} from 'better-auth/oauth2';
import {authorizeMcpBearer} from '../../app/loc/mcp/access-roles.mjs';

const EXTENSION='chrome-extension://hiaeafonocnjaclcfgjmdopbcgnafnna';
const BodySchema=z.discriminatedUnion('action',[
  z.strictObject({action:z.literal('connect'),provider:ProviderIdSchema,email:z.string().min(1).max(320)}),
  z.strictObject({action:z.literal('disconnect'),provider:ProviderIdSchema})
]);

function headers(request){
  const result=new Headers({'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store','x-content-type-options':'nosniff'});
  if(request.headers.get('origin')===EXTENSION){
    result.set('access-control-allow-origin',EXTENSION);
    result.set('vary','Origin');
  }
  return result;
}
function json(request,data,status=200){
  return new Response(JSON.stringify(data),{status,headers:headers(request)});
}
function failure(error){
  const status=error?.httpStatus||error?.status||
    (/unavailable|vault|provider/i.test(String(error?.message||''))?503:400);
  return {status,message:String(error?.message||'LOC MCP provider request failed').slice(0,180)};
}
async function identity(request,env){
 const match=/^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization')||'');
 if(!match)throw Object.assign(new Error('LOC OAuth access token required'),{httpStatus:401});
 let claims;
 try{
  claims=await verifyAccessTokenRequest(requestToResourceInput(request),{
   jwksUrl:'https://auth.lo3rwang.cc/api/auth/jwks',
   verifyOptions:{issuer:'https://auth.lo3rwang.cc/api/auth',
    audience:'https://mcp.lo3rwang.cc',typ:'at+jwt',requiredClaims:['azp']},
   requiredScopes:['openid']
  });
 }catch{throw Object.assign(new Error('LOC OAuth access token invalid'),{httpStatus:401})}
 if(typeof claims?.sub!=='string'||!claims.sub)
  throw Object.assign(new Error('LOC OAuth subject missing'),{httpStatus:401});
 // Reuse Gateway's existing UserInfo identity binding and LOC business roles.
 // Auth does not resolve ScopeID or manage MCP permissions.
 const permission=await authorizeMcpBearer(match[1],claims.sub,env);
 return {subject:claims.sub,email:permission.email};
}
export async function onRequestOptions({request}){
  if(request.headers.get('origin')!==EXTENSION)return new Response(null,{status:403});
  return new Response(null,{status:204,headers:new Headers({
    'access-control-allow-origin':EXTENSION,'access-control-allow-methods':'GET,POST,OPTIONS',
    'access-control-allow-headers':'authorization,content-type','access-control-max-age':'600',vary:'Origin'
  })});
}
export async function onRequestGet({request,env}){
  try{
    const {subject}=await identity(request,env);
    const action=new URL(request.url).searchParams.get('action')||'status';
    if(action!=='status')throw new Error('Unknown MCP provider query');
    return json(request,await providerStatuses(env,subject));
  }catch(error){const result=failure(error);return json(request,{error:result.message},result.status)}
}
export async function onRequestPost({request,env}){
  try{
    const {subject}=await identity(request,env);
    const raw=await request.text();
    if(raw.length>8000)throw new Error('MCP provider request too large');
    const parsed=BodySchema.safeParse(JSON.parse(raw));
    if(!parsed.success)throw new Error('Invalid MCP provider request');
    const body=parsed.data;
    if(body.action==='connect'){
      const email=normalizeSsoEmail(body.email);
      return json(request,await beginUpstreamOAuth(env,subject,body.provider,
        {surface:'extension',email}));
    }
    upstreamProvider(body.provider);
    await disconnectUpstream(env,subject,body.provider);
    await clearToolPolicies(env,subject,body.provider);
    return json(request,{disconnected:true,provider:body.provider});
  }catch(error){const result=failure(error);return json(request,{error:result.message},result.status)}
}
