// Extension-facing upstream MCP SSO control surface.
// LOC Auth OAuth bearer identity is the only browser credential accepted here;
// provider access tokens remain encrypted in the LOC MCP provider vault.
import {z} from 'zod';
import {beginUpstreamOAuth,disconnectUpstream} from '../../app/loc/mcp/upstream-oauth.mjs';
import {providerStatuses,clearToolPolicies} from '../../app/loc/mcp/upstream-policy.mjs';
import {ProviderIdSchema,upstreamProvider} from '../../app/loc/mcp/upstream-providers.mjs';
import {normalizeSsoEmail} from '../../app/loc/mcp/extension-sso.mjs';
import {authorizeMcpRole,VerifiedLocUserInfoSchema}
  from '../../app/loc/mcp/access-roles.mjs';

const EXTENSION='chrome-extension://hiaeafonocnjaclcfgjmdopbcgnafnna';
const AUTH_USERINFO='https://auth.lo3rwang.cc/api/auth/oauth2/userinfo';
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
  const header=request.headers.get('authorization')||'';
  const match=/^Bearer\s+(\S+)$/i.exec(header);
  if(!match)throw Object.assign(new Error('LOC OAuth access token required'),{httpStatus:401});
  let response;
  try{response=await fetch(AUTH_USERINFO,{method:'GET',headers:{authorization:'Bearer '+match[1],accept:'application/json'},
    cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(7000)})}
  catch{throw Object.assign(new Error('LOC OAuth UserInfo unavailable'),{httpStatus:503})}
  if(!response.ok)throw Object.assign(new Error('LOC OAuth identity verification failed'),{httpStatus:401});
  const parsed=VerifiedLocUserInfoSchema.safeParse(await response.json().catch(()=>null));
  if(!parsed.success)throw Object.assign(new Error('Verified LOC OAuth identity required'),{httpStatus:401});
  await authorizeMcpRole(parsed.data.email,env);
  return {subject:parsed.data.sub,email:parsed.data.email};
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
