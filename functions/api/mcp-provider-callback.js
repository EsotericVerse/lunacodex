// Public OAuth callback. The one-time PKCE state binds it to a LOC user.
import {completeUpstreamOAuth} from '../../app/loc/mcp/upstream-oauth.mjs';
import {verifiedLocWebsiteSession} from '../../app/loc/auth/verified-session.mjs';
const RETURN='https://loc.lo3rwang.cc/admin/?section=network';
export async function onRequestGet({request,env}){
  const p=new URL(request.url).searchParams;
  try{
    const session=await verifiedLocWebsiteSession(request);
    const result=await completeUpstreamOAuth(env,{
      code:p.get('code'),state:p.get('state'),error:p.get('error')},session.userId);
    return Response.redirect(RETURN+'&mcp_provider='+encodeURIComponent(result.provider)+'&connected=1',303);
  }catch{
    return Response.redirect(RETURN+'&mcp_provider_error=1',303);
  }
}
export function onRequestPost(){return new Response('Method not allowed',{status:405});}
