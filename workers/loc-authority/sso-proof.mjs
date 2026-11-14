// LOC Auth's Cloudflare SSO proof: a short-lived signed cookie, bound to the
// exact Better Auth session cookie created by a successful OIDC callback.
// This is not a second Session, user registry or OAuth token service.
export const MCP_SSO_REFERENCE='loc-cloudflare-access-v1';
export const MCP_SSO_CLAIM='https://loc.lo3rwang.cc/claims/sso';
export const MCP_EMAIL_CLAIM='https://loc.lo3rwang.cc/claims/email';
export const MCP_SSO_PROVIDER='cloudflare-access';
export const MCP_SSO_COOKIE='__Host-loc-mcp-sso';
const LIFETIME_MS=24*60*60*1000;
const encoder=new TextEncoder();

export function readCookie(header,name){
  if(!header||!name)return '';
  for(const part of String(header).split(';')){
    const index=part.indexOf('=');
    if(index<0)continue;
    if(part.slice(0,index).trim()===name)
      return part.slice(index+1).trim();
  }
  return '';
}
export function sessionCookieFromResponse(headers,name){
  const values=typeof headers?.getSetCookie==='function'
    ?headers.getSetCookie():[headers?.get('set-cookie')||''];
  for(const header of values){
    const first=String(header).split(';',1)[0];
    if(first.startsWith(name+'=')&&first.length>name.length+1)
      return first.slice(name.length+1);
  }
  return '';
}
async function key(secret){
  return crypto.subtle.importKey('raw',encoder.encode(secret),
    {name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
}
function signedPayload(sessionCookie,expiry){
  return encoder.encode('loc:mcp:sso:v1\n'+expiry+'\n'+sessionCookie);
}
function encode(bytes){
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function decode(value){
  if(!/^[A-Za-z0-9_-]{43}$/.test(value))return null;
  try{return Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),
    c=>c.charCodeAt(0))}catch{return null}
}
export async function issueSsoProof(secret,sessionCookie,now=Date.now()){
  if(typeof secret!=='string'||secret.length<32||
     typeof sessionCookie!=='string'||!sessionCookie||sessionCookie.length>2048)
    throw Error('Invalid LOC SSO signing context');
  const expiry=now+LIFETIME_MS;
  const mac=await crypto.subtle.sign('HMAC',await key(secret),
    signedPayload(sessionCookie,expiry));
  return 'v1.'+expiry+'.'+encode(mac);
}
export async function verifySsoProof(secret,sessionCookie,proof,now=Date.now()){
  if(typeof secret!=='string'||secret.length<32||
     typeof sessionCookie!=='string'||!sessionCookie||sessionCookie.length>2048||
     typeof proof!=='string')return false;
  const parts=proof.split('.');
  if(parts.length!==3||parts[0]!=='v1'||!/^\d{13}$/.test(parts[1]))
    return false;
  const expiry=Number(parts[1]),mac=decode(parts[2]);
  if(!mac||expiry<=now||expiry>now+LIFETIME_MS+30000)return false;
  return crypto.subtle.verify('HMAC',await key(secret),
    mac,signedPayload(sessionCookie,expiry));
}
export async function verifiedSsoSession(headers,sessionCookieName,secret,now=Date.now()){
  const cookies=headers?.get?.('cookie')||'';
  return verifySsoProof(secret,readCookie(cookies,sessionCookieName),
    readCookie(cookies,MCP_SSO_COOKIE),now);
}
export function makeSsoProofCookie(proof){
  return MCP_SSO_COOKIE+'='+proof+'; Max-Age=86400; Path=/; Secure; HttpOnly; SameSite=Lax';
}
export function isSuccessfulSsoCallback(request,response){
  const url=new URL(request.url);
  if(request.method!=='GET'||
     url.pathname!=='/api/auth/sso/callback/'+MCP_SSO_PROVIDER||
     response.status<300||response.status>=400)return false;
  const destination=response.headers.get('location');
  if(!destination)return false;
  try{
    const redirect=new URL(destination,url);
    return (redirect.origin==='https://auth.lo3rwang.cc'||
      redirect.origin==='https://loc.lo3rwang.cc')&&
      !redirect.searchParams.has('error');
  }catch{return false}
}
