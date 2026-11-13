// Public OAuth callback. The one-time PKCE state binds it to a LOC user.
import {completeUpstreamOAuth,pendingUpstreamOAuth}
  from '../../app/loc/mcp/upstream-oauth.mjs';
import {verifiedLocWebsiteSession} from '../../app/loc/auth/verified-session.mjs';
import {authorizeMcpRole} from '../../app/loc/mcp/access-roles.mjs';
import {LOC_MCP_EXTENSION_RETURN} from '../../app/loc/mcp/extension-sso.mjs';
const RETURN='https://loc.lo3rwang.cc/admin/?section=network';
export async function onRequestGet({request,env}){
  const p=new URL(request.url).searchParams;
  // Extension upstream OAuth has already been bound to a LOC OAuth subject
  // when its one-time state was created. Finish it without requiring a
  // website cookie, then return only a success marker to chrome.identity.
  try{
    const pending=await pendingUpstreamOAuth(env,p.get('state'));
    if(pending){
      const target=new URL(LOC_MCP_EXTENSION_RETURN);
      target.searchParams.set('state',p.get('state')||'');
      try{
        const result=await completeUpstreamOAuth(env,{
          code:p.get('code'),state:p.get('state'),error:p.get('error')});
        target.searchParams.set('provider',result.provider);
        target.searchParams.set('connected','1');
      }catch{target.searchParams.set('error','upstream_authorization_failed')}
      return Response.redirect(target.href,303);
    }
  }catch{}
  try{
    const session=await verifiedLocWebsiteSession(request);
    // A revoked api.manage role may not finish linking a provider.
    await authorizeMcpRole(session.email,env);
    const result=await completeUpstreamOAuth(env,{
      code:p.get('code'),state:p.get('state'),error:p.get('error')},session.userId);
    return Response.redirect(RETURN+'&mcp_provider='+encodeURIComponent(result.provider)+'&connected=1',303);
  }catch{
    return Response.redirect(RETURN+'&mcp_provider_error=1',303);
  }
}
export function onRequestPost(){return new Response('Method not allowed',{status:405});}
