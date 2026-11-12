// LOC Web control surface for its own MCP upstream client; never a SQL API.
import {verifiedLocWebsiteSession} from '../../app/loc/auth/verified-session.mjs';
import {authorizeMcpRole} from '../../app/loc/mcp/access-roles.mjs';
import {beginUpstreamOAuth,disconnectUpstream} from '../../app/loc/mcp/upstream-oauth.mjs';
import {providerStatuses,setToolPolicy,clearToolPolicies,requestTool,pendingApprovals,
  decideApproval,approvalReceipt} from '../../app/loc/mcp/upstream-policy.mjs';
import {listUpstreamTools} from '../../app/loc/mcp/upstream-tools.mjs';
import {upstreamProvider} from '../../app/loc/mcp/upstream-providers.mjs';

const ORIGIN='https://loc.lo3rwang.cc';
function json(data,status=200){
  return new Response(JSON.stringify(data),{status,headers:{
    'content-type':'application/json; charset=utf-8','cache-control':'no-store',
    'x-content-type-options':'nosniff'}});
}
function reject(message,status=400){
  throw Object.assign(new Error(message),{status});
}
async function identity(request,env){
  const session=await verifiedLocWebsiteSession(request);
  const subject=String(session.userId||'');
  if(!/^loc_[A-Za-z0-9_-]{32,80}$/.test(subject))
    reject('LOC Auth identity required',401);
  // The Admin UI has no independent MCP role or sign-up authority.
  await authorizeMcpRole(session.email,env);
  return subject;
}
function browserConsent(request){
  if(request.headers.get('origin')!==ORIGIN)
    reject('LOC browser origin required',403);
}
async function handler(context){
  try{
    const {request,env}=context;
    const subject=await identity(request,env);
    const url=new URL(request.url);
    if(request.method==='GET'){
      const action=url.searchParams.get('action')||'status';
      if(action==='status')return json(await providerStatuses(env,subject));
      if(action==='tools'){
        const provider=url.searchParams.get('provider')||'';
        upstreamProvider(provider);
        return json({provider,tools:await listUpstreamTools(env,subject,provider)});
      }
      if(action==='pending')return json({items:await pendingApprovals(env,subject)});
      if(action==='receipt')return json(await approvalReceipt(env,subject,
        url.searchParams.get('id')||''));
      reject('Unknown MCP provider query');
    }
    if(request.method!=='POST')reject('Method not allowed',405);
    browserConsent(request);
    const raw=await request.text();
    if(raw.length>16000)reject('MCP control request too large',413);
    let body;try{body=JSON.parse(raw)}catch{reject('Invalid JSON')}
    if(!body||typeof body!=='object'||Array.isArray(body))reject('Invalid MCP control request');
    if(body.action==='call')return json(await requestTool(env,subject,
      body.provider,body.tool,body.args||{}));
    switch(body.action){
      case 'connect':return json(await beginUpstreamOAuth(env,subject,body.provider));
      case 'disconnect':
        await disconnectUpstream(env,subject,body.provider);
        await clearToolPolicies(env,subject,body.provider);
        return json({disconnected:true,provider:body.provider});
      case 'policy':return json(await setToolPolicy(env,subject,
        body.provider,body.tool,body.mode));
      case 'approve':return json(await decideApproval(env,subject,body.id,true));
      case 'reject':return json(await decideApproval(env,subject,body.id,false));
      default:reject('Unknown MCP provider operation');
    }
  }catch(error){
    const status=error.status||error.httpStatus||
      (/not configured|unavailable|expired/i.test(String(error.message))?503:400);
    return json({error:status<500?String(error.message).slice(0,180):
      'LOC MCP upstream provider service unavailable'},status);
  }
}
export const onRequestGet=handler;
export const onRequestPost=handler;
export function onRequestOptions(){return json({error:'Unsupported method'},405);}
