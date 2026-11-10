import {issueDelegation} from '../../app/loc/auth/delegation-contract.mjs';
import {locRegistryRoles,isLocRegistryAdmin,canLocRegistryManage} from './manage-role.mjs';
import {checkExternalAuthQos} from './auth-qos.mjs';
import {handleFirstPartyAuth,hasFirstPartyCookie,firstPartySession,firstPartySignOut} from './better-auth-native.mjs';
import {verifyAuthReference} from './auth-ref.mjs';
import {approvedConsent,recordConsent,revokeConsent,consentPage} from './oauth-consent.mjs';

// Independent OAuth 2.1 authorization server; all state lives in the existing
// LOC Authority Durable Object. No SQL database, Clerk, Neon or vendor Auth SDK.
export const ISSUER='https://auth.lo3rwang.cc';
export const MCP_AUDIENCE='https://mcp.lo3rwang.cc';
export const WEB_AUDIENCE='https://loc.lo3rwang.cc';
export const IMPORT_AUDIENCE=ISSUER+'/v1/import/short';
const EXT_CLIENT=WEB_AUDIENCE+'/extension/oauth/client.json';
const EXT_REDIRECT='https://hiaeafonocnjaclcfgjmdopbcgnafnna.chromiumapp.org/loc';
const EXT_ORIGIN='chrome-extension://hiaeafonocnjaclcfgjmdopbcgnafnna';
const SESSION_COOKIE='__Host-loc-session',CSRF_COOKIE='__Host-loc-csrf';
const TXT=new TextEncoder(),UTF=new TextDecoder();
const CODE_PATTERN=/^[A-Za-z0-9_-]{43,128}$/;
const LOC_SUBJECT=/^loc_[A-Za-z0-9_-]{32,80}$/;
const SCOPE_ID=/^[a-z][a-z0-9]{0,14}$/;
const SESSION_SECONDS=86400,ACCESS_SECONDS=600,REFRESH_SECONDS=86400;
function error(message,status=400){throw Object.assign(new Error(message),{status});}
function enc(value){const bytes=value instanceof Uint8Array?value:TXT.encode(value);let s='';
 for(const b of bytes)s+=String.fromCharCode(b);
 return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function dec(value){if(!/^[A-Za-z0-9_-]+$/.test(String(value||'')))error('Invalid encoding',401);
 const s=atob(value.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(value.length/4)*4,'='));
 return Uint8Array.from(s,c=>c.charCodeAt(0));}
function random(){return enc(crypto.getRandomValues(new Uint8Array(32)));}
async function sha(value){return enc(new Uint8Array(await crypto.subtle.digest('SHA-256',TXT.encode(value))));}
function parseCookies(request){const items=new Map();
 for(const part of String(request.headers.get('cookie')||'').split(';')){
  const n=part.indexOf('=');if(n>0)items.set(part.slice(0,n).trim(),part.slice(n+1).trim());
 }return items;}
function cookie(name,value,age){return name+'='+value+'; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age='+age;}
function corsOrigin(request){const origin=request.headers.get('origin');
 if(!origin)return '';
 if([ISSUER,WEB_AUDIENCE,EXT_ORIGIN].includes(origin)||
  /^chrome-extension:\/\/[a-p]{32}$/.test(origin))return origin;
 try{const u=new URL(origin);if(u.protocol==='https:'&&
  (u.hostname==='chatgpt.com'||u.hostname.endsWith('.chatgpt.com')||
   u.hostname==='openai.com'||u.hostname.endsWith('.openai.com')))return origin;}catch{}
 error('OAuth request origin not trusted',403);
}
function response(value,status=200,origin='',extra={}){
 return new Response(JSON.stringify(value),{status,headers:{
  'content-type':'application/json; charset=utf-8','cache-control':'no-store',
  'x-content-type-options':'nosniff',...(origin?{'access-control-allow-origin':origin,
   'access-control-allow-credentials':'true',vary:'origin'}:{}),...extra}});
}
function redirect(to,cookies=[]){const headers=new Headers({location:to,'cache-control':'no-store'});
 for(const item of cookies)headers.append('set-cookie',item);
 return new Response(null,{status:302,headers});}
function authority(env){if(!env.LOC_AUTHORITY_STATE)error('LOC Authority state missing',503);
 return env.LOC_AUTHORITY_STATE.get(env.LOC_AUTHORITY_STATE.idFromName('loc-authority-control-v1'));}
async function get(stub,kind,secret){return stub.nativeGet(kind+':'+await sha(secret));}
async function put(stub,kind,secret,item){return stub.nativePut(kind+':'+await sha(secret),item);}
async function take(stub,kind,secret){return stub.nativeTake(kind+':'+await sha(secret));}
function validReturnPath(text){
 const path=String(text||'/local/settings/');
 if(!path.startsWith('/')||path.startsWith('//')||path.includes('\\'))return '/local/settings/';
 const url=new URL(path,WEB_AUDIENCE);
 return url.origin===WEB_AUDIENCE?url.pathname+url.search+url.hash:'/local/settings/';
}
function continuation(value){
 const path=String(value||'');
 if(!path.startsWith('/')||path.startsWith('//')||path.includes('\\'))error('Invalid OAuth continuation');
 const url=new URL(path,ISSUER);
 if(url.origin!==ISSUER||url.pathname!=='/oauth/authorize'||url.hash)error('Invalid OAuth continuation');
 return url.pathname+url.search;
}
function scopeFor(kind,value){
 const permitted=new Set(kind==='extension'?['loc:import','offline_access']:
   ['profile','email','offline_access']);
 const parts=[...new Set(String(value||'').split(/\s+/).filter(Boolean))];
 if(!parts.length||parts.some(s=>!permitted.has(s))||
  kind==='extension'&&!parts.includes('loc:import'))error('Invalid OAuth scope');
 return parts.join(' ');
}
function resourceFor(kind,value){
 const expected=kind==='extension'?IMPORT_AUDIENCE:MCP_AUDIENCE;
 if(value&&value!==expected)error('OAuth resource mismatch');
 return expected;
}
function extensionRedirect(uri){return /^https:\/\/[a-p]{32}\.chromiumapp\.org\/loc$/.test(String(uri||''));}
function safeRedirect(uri){try{const u=new URL(uri);return u.protocol==='https:'&&
  !u.username&&!u.password&&!u.hash&&
  (extensionRedirect(uri)||u.hostname==='chatgpt.com'||
   u.hostname.endsWith('.chatgpt.com')||
   u.hostname==='openai.com'||u.hostname.endsWith('.openai.com'));}
 catch{return false;}}
async function clientFor(stub,id){
 if(id===EXT_CLIENT)return {kind:'extension',client_id:id,client_name:'LOC galaxy-link 彩虹橋',redirect_uris:[EXT_REDIRECT]};
 if(!/^loc-mcp-[A-Za-z0-9_-]{43}$/.test(String(id||'')))error('Unregistered OAuth client',401);
 const value=await stub.nativeGet('native-client:'+id);
 if(!value||value.expires<Date.now())error('Unknown OAuth client',401);
 return {...value,kind:value.kind||'mcp'};
}
async function register(request,stub,origin){
 const raw=await request.text();if(raw.length>6000)error('Client registration too large',413);
 let body;try{body=JSON.parse(raw);}catch{error('Invalid OAuth client registration');}
 if(!Array.isArray(body?.redirect_uris)||body.redirect_uris.length<1||
  body.redirect_uris.length>4||body.redirect_uris.some(x=>!safeRedirect(x))||
  body.token_endpoint_auth_method&&body.token_endpoint_auth_method!=='none'||
  body.grant_types&&(!Array.isArray(body.grant_types)||
   body.grant_types.some(x=>!['authorization_code','refresh_token'].includes(x))))
  error('Invalid OAuth client redirect or grant');
 const isExtension=body.redirect_uris.every(extensionRedirect);
 if(!isExtension&&body.redirect_uris.some(extensionRedirect))
   error('Mixed OAuth client redirect types are not allowed');
 const client_id='loc-mcp-'+random(),issued_at=Math.floor(Date.now()/1000);
 const item={client_id,kind:isExtension?'extension':'mcp',redirect_uris:body.redirect_uris,
  client_name:String(body.client_name||'LOC MCP').slice(0,120),
  expires:Date.now()+180*86400000};
 await stub.nativePut('native-client:'+client_id,item);
 return response({client_id,client_id_issued_at:issued_at,
  client_id_expires_at:Math.floor(item.expires/1000),client_secret_expires_at:0,
  redirect_uris:item.redirect_uris,token_endpoint_auth_method:'none',
  response_types:['code'],grant_types:['authorization_code','refresh_token']},201,origin);
}
async function sessionForHash(stub,hash){
 if(!CODE_PATTERN.test(String(hash||'')))return null;
 const s=await stub.nativeGet('native-session:'+hash);
 return s&&s.expires>Date.now()?s:null;
}
async function sessionFromCookie(request,stub,env){
 const token=parseCookies(request).get(SESSION_COOKIE);
 if(!CODE_PATTERN.test(String(token||'')))return null;
 const identity=await sessionForHash(stub,await sha(token));
 if(!identity||identity.identityProvider!=='better-auth-google')return identity;
 // Better Auth is the session authority for Google. The 24h auxiliary
 // LOC OAuth cookie never outlives a verified first-party SSO session.
 const sso=hasFirstPartyCookie(request)?await firstPartySession(request,env):null;
 const link=sso?await stub.nativeGet('native-google-link:'+await sha('google:'+sso.googleAccountId)):null;
 if(sso?.email===identity.email&&link?.subject===identity.subject)return identity;
 await stub.nativeTake('native-session:'+identity.sidHash);
 return null;
}
// Better Auth verifies who Google says the user is. An OAuth app client
// ID/secret does not prove ownership of LOC. Independent LOC Subject binding
// cannot require a pre-existing LOC cookie or first-time sign-in deadlocks.
export async function googleLocSubject(identity,stub,env,prior=null){
 const email=String(identity?.email||'').trim().toLowerCase();
 const googleId=String(identity?.googleAccountId||'');
 if(identity?.emailVerified!==true||!email||
  !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||
  !googleId||googleId.length>256)error('Verified Google identity required',401);
 // Google identity binding must still work if the SQL-backed role registry is
 // unavailable. A registry outage never grants management privileges.
 const key='native-google-link:'+await sha('google:'+googleId);
 const saved=await stub.nativeGet(key);
 if(saved&&(!LOC_SUBJECT.test(String(saved.subject||''))||
  saved.email!==email))error('LOC Google identity binding mismatch',403);
 // An already linked Google identity is authoritative for WHO signed in.
 // A separate authorization check controls write permissions.
 if(saved)return saved.subject;
 let owner=false,registryUnavailable=false;
 try{owner=isLocRegistryAdmin(await locRegistryRoles(env,email));}
 catch(cause){
  if(Number(cause?.status)!==503)throw cause;
  registryUnavailable=true;
  console.warn('[LOC OAuth] role registry unavailable; identity login remains enabled');
 }
 const roots=[...new Set(String(env.LOC_RECOVERY_ROOT_LOC_SUBJECTS||'')
  .split(/[\s,;]+/).filter(x=>LOC_SUBJECT.test(x)))];
 const matches=[];
 // Only the unique verified LOC owner can recover an existing root Subject.
 // An OAuth app ID/Secret, or an old Scope grant for another email, is not "me".
 if(owner){
  if(typeof stub.delegationGrantProfile==='function'){
   for(const root of roots){
    const existing=await stub.delegationGrantProfile('loc',root);
    if(String(existing?.email||'').trim().toLowerCase()===email)matches.push(root);
   }
  }
  const pinned=String(env.LOC_RECOVERY_ROOT_GOOGLE_EMAIL||'').trim().toLowerCase();
  if(roots.length===1&&(pinned===email||owner))
   matches.push(roots[0]);
 }
 const candidates=[...new Set(matches)];
 if(candidates.length>1)error('Ambiguous LOC owner identity mapping',409);
 const root=candidates[0]||'';
 // An already bound Google ID is retained during a registry outage.
 // No new or previously unbound Google account may claim a root Subject.
 if(!owner&&!registryUnavailable&&roots.includes(saved?.subject))
  error('Existing LOC root identity is restricted to the verified owner',403);
 let subject=saved?.subject||'';
 if(root){
  if(typeof stub.nativeBindGoogleOwner!=='function')
   error('LOC owner binding storage unavailable',503);
  await stub.nativeBindGoogleOwner(root,googleId,email);
  subject=root;
 }else if(!subject&&prior&&prior.emailVerified!==false&&
  prior.email===email&&LOC_SUBJECT.test(String(prior.subject||''))&&
  (owner||!roots.includes(prior.subject))){
  subject=prior.subject; // Never inherit the owner's Subject from another account.
 }
 if(!subject)subject='loc_'+(await sha('google:'+googleId)).slice(0,40);
 if(!saved||saved.subject!==subject)
  await stub.nativePut(key,{subject,email});
 return subject;
}
async function sessionFromBetter(request,env,stub,verified=null){
 const identity=verified||await firstPartySession(request,env);
 if(!identity||!identity.emailVerified)error('Verified Better Auth Google identity required',401);
 const prior=await sessionFromCookie(request,stub,env);
 const subject=await googleLocSubject(identity,stub,env,prior);
 const sid=random(),sidHash=await sha(sid);
 const next={subject,provider:'loc',identityProvider:'better-auth-google',
  email:identity.email,emailVerified:true,sidHash,
  // An auxiliary LOC OAuth session cannot outlive its Better Auth SSO.
  expires:Math.min(identity.expires,Date.now()+SESSION_SECONDS*1000)};
 await stub.nativePut('native-session:'+sidHash,next);
 return {session:next,cookie:cookie(SESSION_COOKIE,sid,
  Math.max(1,Math.ceil((next.expires-Date.now())/1000)))};
}
async function issueToken(stub,session,resource,scope,client_id){
 const iat=Math.floor(Date.now()/1000);
 return {access_token:await stub.signLocDelegation({iss:ISSUER,sub:session.subject,
   aud:resource,scope,client_id,sid:session.sidHash,
   email:session.email,email_verified:session.emailVerified!==false,iat,nbf:iat-5,
   exp:iat+ACCESS_SECONDS,jti:crypto.randomUUID()}),
  token_type:'Bearer',expires_in:ACCESS_SECONDS,scope};
}
export function isNativeOAuthPath(path){
 return path==='/.well-known/oauth-authorization-server'||path==='/oauth/register'||
  path==='/oauth/consent'||path==='/oauth/consent/web'||path==='/oauth/consent/revoke'||
  path==='/oauth/authorize'||path==='/oauth/login'||path==='/oauth/token'||
  path==='/oauth/revoke'||
  path==='/oauth/callback/github'||path==='/oauth/callback/oidc'||
  path==='/oauth/complete'||
  path==='/oauth/logout'||path==='/oauth/ref'||
  path==='/v1/auth/session'||path==='/v1/import/short';
}
export function looksLikeNativeToken(request){
 const bearer=/^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization')||'');
 if(!bearer||bearer[1].length>8192)return false;
 const parts=bearer[1].split('.');if(parts.length!==3)return false;
 try{return JSON.parse(UTF.decode(dec(parts[1]))).iss===ISSUER;}catch{return false;}
}
export async function verifyNativeOAuth(request,env,resource){
 const bearer=/^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization')||'');
 if(!bearer||bearer[1].length>8192)error('LOC OAuth Bearer required',401);
 const parts=bearer[1].split('.');if(parts.length!==3)error('Invalid JWT',401);
 let head,claims;try{head=JSON.parse(UTF.decode(dec(parts[0])));
  claims=JSON.parse(UTF.decode(dec(parts[1])));}catch{error('Invalid JWT',401);}
 const now=Math.floor(Date.now()/1000);
 if(head.alg!=='RS256'||typeof head.kid!=='string'||claims.iss!==ISSUER||
  claims.aud!==resource||!LOC_SUBJECT.test(String(claims.sub||''))||
  !CODE_PATTERN.test(String(claims.sid||''))||typeof claims.email_verified!=='boolean'||
  !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(claims.email||''))||
  !Number.isSafeInteger(claims.iat)||claims.iat>now+60||
  !Number.isSafeInteger(claims.nbf)||claims.nbf>now+60||
  !Number.isSafeInteger(claims.exp)||claims.exp<=now||
  claims.exp-claims.iat>ACCESS_SECONDS+30)
  error('Invalid LOC OAuth claims',401);
 const stub=authority(env);
 const jwks=await stub.delegationJwks();
 const jwk=jwks.keys.find(x=>x.kid===head.kid&&x.kty==='RSA'&&x.alg==='RS256');
 if(!jwk)error('Unknown LOC OAuth signing key',401);
 let valid=false;
 try{const key=await crypto.subtle.importKey('jwk',jwk,
  {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
 valid=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,
  dec(parts[2]),TXT.encode(parts[0]+'.'+parts[1]));}catch{}
 if(!valid)error('LOC OAuth signature invalid',401);
 const session=await sessionForHash(stub,claims.sid);
 if(!session||session.subject!==claims.sub||session.email!==claims.email||
  (session.emailVerified!==false)!==claims.email_verified)
   error('LOC OAuth session revoked',401);
 return {provider:'loc',subject:session.subject,email:session.email,
  session:session.sidHash,scope:String(claims.scope||''),client_id:claims.client_id,
  emailVerified:claims.email_verified};
}
async function authorize(request,url,stub,env){
 const p=url.searchParams;
 if(p.get('response_type')!=='code')error('Only authorization code supported');
 const client=await clientFor(stub,p.get('client_id'));
 const redirect_uri=p.get('redirect_uri')||'';
 if(!client.redirect_uris.includes(redirect_uri))error('Invalid OAuth redirect URI');
 const challenge=p.get('code_challenge')||'';
 if(!CODE_PATTERN.test(challenge)||p.get('code_challenge_method')!=='S256')
  error('PKCE S256 required');
 const state=p.get('state')||'';
 if(state.length<16||state.length>512)error('Invalid OAuth state');
 const resource=resourceFor(client.kind,p.get('resource'));
 const scope=scopeFor(client.kind,p.get('scope')||
  (client.kind==='extension'?'loc:import offline_access':'profile email offline_access'));
 let session=await sessionFromCookie(request,stub,env);
 let bridged=null;
 if(!session&&hasFirstPartyCookie(request)){
  bridged=await sessionFromBetter(request,env,stub);
  session=bridged.session;
 }
 if(!session){
  const next=new URL('/login/index.html',WEB_AUDIENCE);
  next.searchParams.set('continue',url.pathname+url.search);
  return redirect(next.href);
 }
 const details={sidHash:session.sidHash,subject:session.subject,
  client_id:client.client_id,client_name:client.client_name||'LOC MCP',
  redirect_uri,scope,resource,challenge,state};
 if(await approvedConsent(stub,session.subject,client.client_id,resource,scope))
  return authorizedCode(stub,details,bridged?[bridged.cookie]:[]);
 const nonce=random();
 await put(stub,'native-consent-pending',nonce,{
  ...details,expires:Date.now()+600000
 });
 return new Response(consentPage({nonce,clientName:details.client_name,scope,
  resource,identity:session.email}),{status:200,headers:{
  'content-type':'text/html; charset=utf-8','cache-control':'no-store',
  'content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  'x-content-type-options':'nosniff',
  ...(bridged?{'set-cookie':bridged.cookie}:{})
 }});
}
const WEB_CONSENT_SCOPE='profile email loc:manage';
const WEB_CONSENT_CLIENT='loc-web';
async function startWebConsent(stub,session,next,cookies=[]){
 if(!next.startsWith(WEB_AUDIENCE+'/')&&
  !next.startsWith(ISSUER+'/oauth/authorize?'))
  error('Invalid LOC SSO continuation',400);
 if(await approvedConsent(stub,session.subject,WEB_CONSENT_CLIENT,
  WEB_AUDIENCE,WEB_CONSENT_SCOPE))
  return redirect(next,cookies);
 const nonce=random();
 await put(stub,'native-consent-pending',nonce,{
  kind:'web',sidHash:session.sidHash,subject:session.subject,
  client_id:WEB_CONSENT_CLIENT,client_name:'LOC 網站',
  scope:WEB_CONSENT_SCOPE,resource:WEB_AUDIENCE,next,
  expires:Date.now()+600000
 });
 return redirect(ISSUER+'/oauth/consent/web?nonce='+encodeURIComponent(nonce),cookies);
}
async function webConsentPage(request,url,stub,env){
 let session=await sessionFromCookie(request,stub,env),bridged=null;
 if(!session&&hasFirstPartyCookie(request)){
  bridged=await sessionFromBetter(request,env,stub);
  session=bridged.session;
 }
 if(!session){
  const dest=new URL('/login/index.html',WEB_AUDIENCE);
  dest.searchParams.set('return_to',validReturnPath(url.searchParams.get('return_to')));
  return redirect(dest.href);
 }
 const nonce=url.searchParams.get('nonce');
 if(!nonce){
  const next=WEB_AUDIENCE+validReturnPath(url.searchParams.get('return_to'));
  return startWebConsent(stub,session,next,bridged?[bridged.cookie]:[]);
 }
 if(!CODE_PATTERN.test(nonce))error('Invalid LOC web consent',400);
 const pending=await get(stub,'native-consent-pending',nonce);
 if(!pending||pending.kind!=='web'||pending.sidHash!==session.sidHash||
  pending.subject!==session.subject||pending.expires<Date.now())
  error('LOC web consent request expired',401);
 return new Response(consentPage({nonce,clientName:'LOC 網站',
  scope:WEB_CONSENT_SCOPE,resource:WEB_AUDIENCE,identity:session.email}),
  {status:200,headers:{
   'content-type':'text/html; charset=utf-8','cache-control':'no-store',
   'content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
   'x-content-type-options':'nosniff',
   ...(bridged?{'set-cookie':bridged.cookie}:{})
  }});
}
async function authorizedCode(stub,details,cookies=[]){
 const code=random();
 await put(stub,'native-code',code,{sidHash:details.sidHash,
  client_id:details.client_id,redirect_uri:details.redirect_uri,
  scope:details.scope,resource:details.resource,challenge:details.challenge,
  expires:Date.now()+300000});
 const result=new URL(details.redirect_uri);
 result.searchParams.set('code',code);
 result.searchParams.set('state',details.state);
 result.searchParams.set('iss',ISSUER);
 return redirect(result.href,cookies);
}
async function consentResponse(request,stub,env){
 if(request.headers.get('origin')!==ISSUER)error('Consent origin required',403);
 if(!String(request.headers.get('content-type')||'').toLowerCase()
  .startsWith('application/x-www-form-urlencoded'))
  error('Consent form required',415);
 const raw=await request.text();if(raw.length>600)error('Consent response too large',413);
 const form=new URLSearchParams(raw),nonce=form.get('nonce')||'';
 if(!CODE_PATTERN.test(nonce))error('Invalid consent request',400);
 const details=await take(stub,'native-consent-pending',nonce);
 const session=await sessionFromCookie(request,stub,env);
 if(!details||!session||details.sidHash!==session.sidHash||
  details.subject!==session.subject||details.expires<Date.now())
  error('Consent session or request expired',401);
 if(details.kind==='web'){
  if(details.client_id!==WEB_CONSENT_CLIENT||
   details.resource!==WEB_AUDIENCE||details.scope!==WEB_CONSENT_SCOPE||
   typeof details.next!=='string'||!details.next.startsWith(WEB_AUDIENCE+'/'))
    error('Invalid LOC web consent contract',400);
  if(form.get('decision')==='deny')return redirect(WEB_AUDIENCE+'/');
  if(form.get('decision')!=='approve')
   error('Explicit consent decision required',400);
  await recordConsent(stub,session.subject,WEB_CONSENT_CLIENT,
   WEB_AUDIENCE,WEB_CONSENT_SCOPE);
  return redirect(details.next);
 }
 const client=await clientFor(stub,details.client_id);
 if(!client.redirect_uris.includes(details.redirect_uri)||
  resourceFor(client.kind,details.resource)!==details.resource||
  scopeFor(client.kind,details.scope)!==details.scope)
  error('Consent application or scope changed',400);
 const decision=form.get('decision');
 if(decision==='deny'){
  const result=new URL(details.redirect_uri);
  result.searchParams.set('error','access_denied');
  result.searchParams.set('state',details.state);
  result.searchParams.set('iss',ISSUER);
  return redirect(result.href);
 }
 if(decision!=='approve')error('Explicit consent decision required',400);
 await recordConsent(stub,session.subject,details.client_id,details.resource,details.scope);
 return authorizedCode(stub,details);
}
async function revokeConsentResponse(request,stub,env){
 if(request.headers.get('origin')!==ISSUER)error('Consent origin required',403);
 if(!String(request.headers.get('content-type')||'').toLowerCase()
  .startsWith('application/x-www-form-urlencoded'))error('Consent form required',415);
 const raw=await request.text();if(raw.length>1500)error('Consent revoke too large',413);
 const form=new URLSearchParams(raw);
 const session=await sessionFromCookie(request,stub,env);
 if(!session)error('LOC session required to revoke consent',401);
 const client=await clientFor(stub,form.get('client_id'));
 const resource=resourceFor(client.kind,form.get('resource'));
 await revokeConsent(stub,session.subject,client.client_id,resource);
 return response({revoked:true});
}
async function provider(stub,name){
 const item=await stub.nativeProvider(name);
 if(!item?.client_id||!item.client_secret)error('External '+name+' OAuth not configured',503);
 return item;
}
async function discovery(config){
 const base=new URL(config.issuer_url);
 if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash)
  error('Invalid OIDC provider',503);
 const issuer=base.href.replace(/\/$/,'');
 const metadata=await requestJson(new URL('.well-known/openid-configuration',issuer+'/'));
 if(metadata.issuer!==issuer||![
  metadata.authorization_endpoint,metadata.token_endpoint,metadata.jwks_uri
 ].every(x=>{try{return new URL(x).protocol==='https:';}catch{return false;}}))
  error('OIDC issuer metadata invalid',503);
 return metadata;
}
async function requestJson(url,options={}){
 const r=await fetch(url,{...options,redirect:'manual',
  signal:AbortSignal.timeout(8000)});
 if(!r.ok)error('External identity provider unavailable',502);
 return r.json().catch(()=>error('Invalid identity provider response',502));
}
async function googleViaBetter(request,url,stub,env){
 const continue_path=url.searchParams.get('continue')?
  continuation(url.searchParams.get('continue')):'';
 const return_to=continue_path?'':validReturnPath(url.searchParams.get('return_to'));
 const state=random(),csrf=random();
 const complete=new URL('/oauth/complete',ISSUER);complete.searchParams.set('state',state);
 // Keep Cloudflare's verified client IP across the internal Better Auth
 // Google request, avoiding a shared rate-limit bucket for every login.
 const ip=request.headers.get('cf-connecting-ip');
 const headers={origin:ISSUER,'content-type':'application/json',
  ...(ip?{'cf-connecting-ip':ip}:{})};
 const upstream=await handleFirstPartyAuth(new Request(ISSUER+'/api/auth/sign-in/social',{
  method:'POST',headers,
  body:JSON.stringify({provider:'google',callbackURL:complete.href})}),env);
 if(!upstream.ok)error('LOC Google Better Auth sign-in unavailable',upstream.status);
 const info=await upstream.json().catch(()=>null);
 let target;try{target=new URL(info?.url)}catch{error('Invalid Better Auth Google redirect',502)}
 if(target.protocol!=='https:'||target.hostname!=='accounts.google.com')
  error('Unexpected Google OAuth authorization host',502);
 await put(stub,'native-login',state,{provider:'better-google',csrfHash:await sha(csrf),
  continue_path,return_to,expires:Date.now()+600000});
 const cookies=[cookie(CSRF_COOKIE,csrf,600)];
 for(const item of upstream.headers.getSetCookie?.()||[])cookies.push(item);
 return redirect(target.href,cookies);
}
async function completeBetterGoogle(request,url,stub,env){
 const state=url.searchParams.get('state')||'';
 if(!CODE_PATTERN.test(state))error('Invalid LOC Google continuation',401);
 const pending=await take(stub,'native-login',state);
 const csrf=parseCookies(request).get(CSRF_COOKIE);
 if(!pending||pending.provider!=='better-google'||pending.expires<Date.now()||
   !csrf||await sha(csrf)!==pending.csrfHash)
  error('LOC Google continuation state invalid',401);
 const {session:identity,cookie:sessionCookie}=await sessionFromBetter(request,env,stub);
 const next=pending.continue_path?ISSUER+pending.continue_path:WEB_AUDIENCE+pending.return_to;
 const cookies=[sessionCookie,cookie(CSRF_COOKIE,'',0)];
 return pending.continue_path?redirect(next,cookies):
  startWebConsent(stub,identity,next,cookies);
}
async function login(request,url,stub,env){
 const name=url.searchParams.get('provider');
 if(!name){
  const next=new URL('/login/index.html',WEB_AUDIENCE);
  const continuePath=url.searchParams.get('continue');
  if(continuePath)next.searchParams.set('continue',continuation(continuePath));
  else next.searchParams.set('return_to',validReturnPath(url.searchParams.get('return_to')));
  return redirect(next.href);
 }
 if(name==='google')return googleViaBetter(request,url,stub,env);
 if(!['github','oidc'].includes(name))error('Unknown identity provider');
 const config=await provider(stub,name);
 const callback=ISSUER+'/oauth/callback/'+name;
 if(String(config.callback_url||'')!==callback)
  error('OAuth provider callback must use the LOC Auth domain',503);
 const continue_path=url.searchParams.get('continue')?
   continuation(url.searchParams.get('continue')):'';
 const return_to=continue_path?'':validReturnPath(url.searchParams.get('return_to'));
 const state=random(),csrf=random(),nonce=random();
 await put(stub,'native-login',state,{provider:name,csrfHash:await sha(csrf),
  continue_path,return_to,nonce,expires:Date.now()+600000});
 let target;
 if(name==='github'){
  target=new URL('https://github.com/login/oauth/authorize');
  target.searchParams.set('client_id',config.client_id);
  target.searchParams.set('scope','read:user user:email');
 }else{
  const meta=await discovery(config);
  target=new URL(meta.authorization_endpoint);
  target.searchParams.set('client_id',config.client_id);
  target.searchParams.set('scope','openid profile email');
  target.searchParams.set('nonce',nonce);
 }
 for(const [key,value] of Object.entries({response_type:'code',state,
  redirect_uri:callback}))
  target.searchParams.set(key,value);
 return redirect(target.href,[cookie(CSRF_COOKIE,csrf,600)]);
}
async function github(config,code){
 const token=await requestJson('https://github.com/login/oauth/access_token',{
  method:'POST',headers:{accept:'application/json','content-type':'application/json'},
  body:JSON.stringify({client_id:config.client_id,
   client_secret:config.client_secret,code,redirect_uri:ISSUER+'/oauth/callback/github'})});
 if(!token.access_token)error('GitHub OAuth token exchange rejected',401);
 const headers={authorization:'Bearer '+token.access_token,accept:'application/vnd.github+json',
  'user-agent':'LOC-Authority'};
 const [user,emails]=await Promise.all([
  requestJson('https://api.github.com/user',{headers}),
  requestJson('https://api.github.com/user/emails',{headers})]);
 const email=Array.isArray(emails)?
  emails.find(x=>x.verified&&x.primary)||emails.find(x=>x.verified):null;
 if(!Number.isSafeInteger(user.id)||!email?.email)error('GitHub verified email required',403);
 return {provider:'github',id:String(user.id),email:String(email.email).toLowerCase()};
}
async function oidc(config,code,nonce){
 const meta=await discovery(config);
 const token=await requestJson(meta.token_endpoint,{method:'POST',
  headers:{'content-type':'application/x-www-form-urlencoded'},
  body:new URLSearchParams({grant_type:'authorization_code',code,
   redirect_uri:ISSUER+'/oauth/callback/oidc',
   client_id:config.client_id,client_secret:config.client_secret}).toString()});
 const jwt=String(token.id_token||'').split('.');
 if(jwt.length!==3)error('OIDC ID Token missing',401);
 let header,claims;try{header=JSON.parse(UTF.decode(dec(jwt[0])));
  claims=JSON.parse(UTF.decode(dec(jwt[1])));}catch{error('OIDC token invalid',401);}
 const now=Math.floor(Date.now()/1000);
 if(header.alg!=='RS256'||claims.iss!==meta.issuer||
  !(Array.isArray(claims.aud)?claims.aud.includes(config.client_id):claims.aud===config.client_id)||
  claims.nonce!==nonce||claims.email_verified!==true||
  !claims.sub||!claims.email||!Number.isSafeInteger(claims.exp)||
  !Number.isSafeInteger(claims.iat)||claims.exp<=now||
  claims.iat>now+60||claims.iat<now-3600||
  (claims.azp&&claims.azp!==config.client_id))
  error('OIDC identity claims invalid',401);
 const keys=await requestJson(meta.jwks_uri);
 const jwk=keys?.keys?.find(k=>k.kid===header.kid&&k.kty==='RSA'&&
  (!k.alg||k.alg==='RS256'));if(!jwk)error('OIDC signing key not found',401);
 let valid=false;try{
  const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',
   hash:'SHA-256'},false,['verify']);
  valid=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,
   dec(jwt[2]),TXT.encode(jwt[0]+'.'+jwt[1]));
 }catch{}
 if(!valid)error('OIDC signature invalid',401);
 return {provider:'oidc',id:meta.issuer+':'+claims.sub,
  email:String(claims.email).toLowerCase()};
}
function refIssuer(type,profile){
 if(type==='entra'){
  const tenant=String(profile.tenant_id||'');
  if(!/^[A-Za-z0-9-]{4,100}$/.test(tenant))error('Invalid Entra tenant',503);
  return 'https://login.microsoftonline.com/'+tenant+'/v2.0';
 }
 return type==='ad'||type==='ldap'?profile.bridge_issuer_url:profile.issuer_url;
}
async function verifiedLocPrincipal(request,env,stub){
 const existing=await sessionFromCookie(request,stub,env);
 return existing?{subject:existing.subject,email:existing.email}:null;
}
async function refLogin(request,url,stub,env){
 const type=String(url.searchParams.get('provider')||'');
 if(!['github','oidc','entra','ad','ldap'].includes(type))
  error('Unsupported interactive Auth Ref provider',400);
 const principal=await verifiedLocPrincipal(request,env,stub);
 if(!principal)error('LOC session required before Auth Ref',401);
 const config=await stub.authRefProfile(type);
 const name=type==='github'?'github':'oidc';
 const callback=ISSUER+'/oauth/callback/'+name;
 if(String(config.callback_url||'')!==callback||!config.client_id||!config.client_secret)
  error('Auth Ref provider callback or OAuth credentials are not configured',503);
 const state=random(),csrf=random(),nonce=random();
 const return_to=validReturnPath(url.searchParams.get('return_to'));
 await put(stub,'native-login',state,{provider:name,refType:type,
  refSubject:principal.subject,return_to,csrfHash:await sha(csrf),
  nonce,expires:Date.now()+600000});
 let target;
 if(name==='github'){
  target=new URL('https://github.com/login/oauth/authorize');
  target.searchParams.set('client_id',config.client_id);
  target.searchParams.set('scope','read:user user:email');
 }else{
  const metadata=await discovery({issuer_url:refIssuer(type,config)});
  target=new URL(metadata.authorization_endpoint);
  target.searchParams.set('client_id',config.client_id);
  target.searchParams.set('scope','openid profile email');
  target.searchParams.set('nonce',nonce);
 }
 for(const [key,value] of Object.entries({response_type:'code',state,
  redirect_uri:callback}))target.searchParams.set(key,value);
 return redirect(target.href,[cookie(CSRF_COOKIE,csrf,600)]);
}

async function callback(request,url,stub,name,env){
 const state=url.searchParams.get('state')||'',code=url.searchParams.get('code')||'';
 if(!CODE_PATTERN.test(state)||!code||code.length>2000)
  error('Invalid OAuth callback',401);
 const pending=await take(stub,'native-login',state);
 const csrf=parseCookies(request).get(CSRF_COOKIE);
 if(!pending||pending.provider!==name||pending.expires<Date.now()||
  !csrf||await sha(csrf)!==pending.csrfHash)
  error('OAuth CSRF validation failed',401);
 if(pending.refType){
  const principal=await verifiedLocPrincipal(request,env,stub);
  if(!principal||principal.subject!==pending.refSubject)
    error('LOC Auth Ref identity changed during provider consent',403);
  const type=pending.refType,config=await stub.authRefProfile(type);
  if(String(config.callback_url||'')!==ISSUER+'/oauth/callback/'+name)
    error('Auth Ref callback must remain on LOC',503);
  let credential='';
  if(name==='github'){
   const token=await requestJson('https://github.com/login/oauth/access_token',{
     method:'POST',headers:{accept:'application/json','content-type':'application/json'},
     body:JSON.stringify({client_id:config.client_id,
       client_secret:config.client_secret,code,
       redirect_uri:ISSUER+'/oauth/callback/github'})});
   credential=String(token.access_token||'');
  }else{
   const meta=await discovery({issuer_url:refIssuer(type,config)});
   const token=await requestJson(meta.token_endpoint,{
     method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
     body:new URLSearchParams({grant_type:'authorization_code',code,
      redirect_uri:ISSUER+'/oauth/callback/oidc',
      client_id:config.client_id,client_secret:config.client_secret}).toString()});
   credential=String(token.id_token||'');
  }
  const assertion=await verifyAuthReference(type,credential,config,
    name==='oidc'?{expectedNonce:pending.nonce}:{});
  await stub.recordAuthReference(principal.subject,assertion);
  return redirect(WEB_AUDIENCE+pending.return_to,[cookie(CSRF_COOKIE,'',0)]);
 }
 const config=await provider(stub,name);
 const identity=name==='github'?await github(config,code):await oidc(config,code,pending.nonce);
 const subject='loc_'+(await sha(identity.provider+':'+identity.id)).slice(0,40);
 const sid=random(),sidHash=await sha(sid);
 const session={subject,provider:'loc',identityProvider:identity.provider,
  email:identity.email,sidHash,expires:Date.now()+SESSION_SECONDS*1000};
 await stub.nativePut('native-session:'+sidHash,session);
 const dest=pending.continue_path?ISSUER+pending.continue_path:
  WEB_AUDIENCE+'/login/index.html?return_to='+encodeURIComponent(pending.return_to);
 const cookies=[cookie(SESSION_COOKIE,sid,SESSION_SECONDS),cookie(CSRF_COOKIE,'',0)];
 return pending.continue_path?redirect(dest,cookies):
  startWebConsent(stub,session,dest,cookies);
}
async function token(request,stub,origin){
 if(!String(request.headers.get('content-type')||'').toLowerCase()
  .startsWith('application/x-www-form-urlencoded'))error('OAuth form required',415);
 const text=await request.text();if(text.length>7000)error('OAuth token form too large',413);
 const input=new URLSearchParams(text),grant=input.get('grant_type'),id=input.get('client_id');
 const client=await clientFor(stub,id);
 if(grant==='authorization_code'){
  const code=input.get('code')||'',verifier=input.get('code_verifier')||'';
  if(!CODE_PATTERN.test(code)||!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier))
   error('OAuth PKCE verifier invalid',401);
  const item=await take(stub,'native-code',code);
  if(!item||item.expires<Date.now()||item.client_id!==client.client_id||
   item.redirect_uri!==input.get('redirect_uri')||
   item.challenge!==await sha(verifier))
   error('Authorization code already used or invalid',401);
  if(input.has('resource')&&input.get('resource')!==item.resource)
   error('OAuth resource mismatch',401);
  const session=await sessionForHash(stub,item.sidHash);
  if(!session)error('LOC session expired',401);
  if(!await approvedConsent(stub,session.subject,client.client_id,item.resource,item.scope))
   error('LOC OAuth data consent missing or revoked',403);
  const refresh=random();
  await put(stub,'native-refresh',refresh,{sidHash:item.sidHash,
   client_id:client.client_id,scope:item.scope,resource:item.resource,
   expires:Date.now()+REFRESH_SECONDS*1000});
  return response({...await issueToken(stub,session,item.resource,item.scope,client.client_id),
   refresh_token:refresh},200,origin);
 }
 if(grant==='refresh_token'){
  const old=input.get('refresh_token')||'';
  if(!CODE_PATTERN.test(old))error('Invalid refresh token',401);
  const item=await take(stub,'native-refresh',old);
  if(!item||item.client_id!==client.client_id||item.expires<Date.now())
   error('Refresh token revoked or expired',401);
  if(input.has('resource')&&input.get('resource')!==item.resource)
   error('OAuth resource mismatch',401);
  const session=await sessionForHash(stub,item.sidHash);
  if(!session)error('LOC session expired',401);
  if(!await approvedConsent(stub,session.subject,client.client_id,item.resource,item.scope))
   error('LOC OAuth data consent missing or revoked',403);
  const refresh=random();
  await put(stub,'native-refresh',refresh,{...item,
   expires:Date.now()+REFRESH_SECONDS*1000});
  return response({...await issueToken(stub,session,item.resource,item.scope,client.client_id),
   refresh_token:refresh},200,origin);
 }
 error('Unsupported OAuth grant');
}
// RFC 7009: revoking an unknown token succeeds without revealing validity;
// a public client may only consume refresh records issued to that client.
async function revoke(request,stub,origin){
 if(!String(request.headers.get('content-type')||'').toLowerCase()
  .startsWith('application/x-www-form-urlencoded'))error('OAuth form required',415);
 const raw=await request.text();
 if(raw.length>3000)error('Revocation form too large',413);
 const form=new URLSearchParams(raw),clientId=String(form.get('client_id')||'');
 await clientFor(stub,clientId);
 const secret=String(form.get('token')||'');
 if(CODE_PATTERN.test(secret)){
  const key='native-refresh:'+await sha(secret);
  const saved=await stub.nativeGet(key);
  if(saved?.client_id===clientId)await stub.nativeTake(key);
 }
 return response({},200,origin);
}
async function session(request,stub,origin,env){
 let identity=await sessionFromCookie(request,stub,env),bridged=null;

 if(!identity&&hasFirstPartyCookie(request)){
  const sso=await firstPartySession(request,env);
  if(sso){
   bridged=await sessionFromBetter(request,env,stub,sso);
   identity=bridged.session;
  }
 }
 if(!identity)return response({session:null,user:null},200,origin);
 const auth=await issueToken(stub,identity,WEB_AUDIENCE,'profile email','loc-web');
 const user={id:identity.subject,email:identity.email,emailVerified:identity.emailVerified!==false};
 return response({session:{...auth,user,expires_at:Math.floor(Date.now()/1000)+ACCESS_SECONDS},
  user,provider:'loc'},200,origin,bridged?{'set-cookie':bridged.cookie}:{});
}
async function logout(request,stub,origin,env){
 const csrf=String(request.headers.get('origin')||'');
 if(csrf&&csrf!==WEB_AUDIENCE&&csrf!==ISSUER)error('Cross-origin logout forbidden',403);
 const sid=parseCookies(request).get(SESSION_COOKIE);
 if(sid&&CODE_PATTERN.test(sid))await stub.nativeTake('native-session:'+await sha(sid));
 const result=response({signed_out:true},200,origin,
  {'set-cookie':cookie(SESSION_COOKIE,'',0)});
 if(hasFirstPartyCookie(request)){
  const revoked=await firstPartySignOut(request,env);
  if(!revoked.ok)error('Better Auth session revoke failed',502);
  for(const item of revoked.headers.getSetCookie?.()||[])
   result.headers.append('set-cookie',item);
 }
 return result;
}
async function importShort(request,env,stub,origin){
 const identity=await verifyNativeOAuth(request,env,IMPORT_AUDIENCE);
 if(!identity.scope.split(/\s+/).includes('loc:import'))error('Import scope required',403);
 const requestedScope=new URL(request.url).searchParams.get('scopeid');
 const scope=requestedScope===null?String(env.LOC_IMPORT_SCOPE_ID||'lo3rwang'):requestedScope;
 if(!SCOPE_ID.test(scope))error('Import Scope invalid',503);
 const roles=identity.provider==='loc'&&identity.emailVerified===true
   ?await locRegistryRoles(env,identity.email):[];
 if(!canLocRegistryManage(roles,scope))
   error('Verified LOC registry management role required for import',403);
 const raw=await request.text();
 if(TXT.encode(raw).length>1048576)error('Import batch too large',413);
 let batch;try{batch=JSON.parse(raw);}catch{error('Invalid import JSON');}
 if(!batch||typeof batch!=='object'||Array.isArray(batch))
  error('Invalid import batch');
 // LOC Auth owns OAuth; the existing LOC Pages application writes via its
 // own Kysely connection. It accepts only a signed Scope-specific import.
 const endpoint='https://loc.lo3rwang.cc/api/loc-native';
 const now=Math.floor(Date.now()/1000);
 const selectedTarget=await stub.selectedDatabaseForDelegation(identity.subject,isLocRegistryAdmin(roles));
 const delegation=issueDelegation({sub:identity.subject,email:identity.email,
  grants:[scope+':write'],audience:'sql',sid:crypto.randomUUID(),now,seconds:300,
  targetId:selectedTarget});
 const signed=await stub.signLocDelegation(delegation);
 const upstream=await fetch(endpoint,{method:'POST',
  headers:{authorization:'Bearer '+signed,'content-type':'application/json'},
  body:JSON.stringify({kind:'short-import',scopeid:scope,batch}),
  signal:AbortSignal.timeout(25000),redirect:'manual'});
 if(upstream.type==='opaqueredirect'||upstream.status>=300&&upstream.status<400)
  error('Unexpected LOC application redirect',502);
 return new Response(upstream.body,{status:upstream.status,headers:{
  'content-type':'application/json; charset=utf-8','cache-control':'no-store',
  ...(origin?{'access-control-allow-origin':origin,vary:'origin'}:{})}});
}
export async function handleNativeOAuth(request,env){
 let origin='';
 try{
  const url=new URL(request.url);
  origin=corsOrigin(request);
  if(request.method==='OPTIONS'){
   if(!origin)error('CORS origin required',403);
   return new Response(null,{status:204,headers:{
    'access-control-allow-origin':origin,'access-control-allow-credentials':'true',
    'access-control-allow-methods':'GET,POST,OPTIONS',
    'access-control-allow-headers':'content-type,authorization',
    'access-control-max-age':'600','cache-control':'no-store',vary:'origin'}});
  }
  const limited=await checkExternalAuthQos(request,env);
  if(limited)return limited;
  const stub=authority(env),path=url.pathname;
  if(path==='/.well-known/oauth-authorization-server'&&request.method==='GET')
   return response({issuer:ISSUER,authorization_endpoint:ISSUER+'/oauth/authorize',
    token_endpoint:ISSUER+'/oauth/token',revocation_endpoint:ISSUER+'/oauth/revoke',
    registration_endpoint:ISSUER+'/oauth/register',
    jwks_uri:ISSUER+'/.well-known/jwks.json',
    response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],
    code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none'],
    scopes_supported:['profile','email','offline_access','loc:import'],
    resource_parameter_supported:true,loc_import_scope_routing:'query-v1'},200,origin);
  if(path==='/oauth/register'&&request.method==='POST')return await register(request,stub,origin);
  if(path==='/oauth/authorize'&&request.method==='GET')return await authorize(request,url,stub,env);
   if(path==='/oauth/consent'&&request.method==='POST')return await consentResponse(request,stub,env);
   if(path==='/oauth/consent/web'&&request.method==='GET')return await webConsentPage(request,url,stub,env);
   if(path==='/oauth/consent/revoke'&&request.method==='POST')return await revokeConsentResponse(request,stub,env);
  if(path==='/oauth/login'&&request.method==='GET')return await login(request,url,stub,env);
   if(path==='/oauth/complete'&&request.method==='GET')
    return await completeBetterGoogle(request,url,stub,env);
  if(path==='/oauth/ref'&&request.method==='GET')return await refLogin(request,url,stub,env);
  if(path==='/oauth/callback/github'&&request.method==='GET')
   return await callback(request,url,stub,'github',env);
  if(path==='/oauth/callback/oidc'&&request.method==='GET')
   return await callback(request,url,stub,'oidc',env);
  if(path==='/oauth/token'&&request.method==='POST')return await token(request,stub,origin);
  if(path==='/oauth/revoke'&&request.method==='POST')return await revoke(request,stub,origin);
  if(path==='/v1/auth/session'&&request.method==='GET')return await session(request,stub,origin,env);
  if(path==='/oauth/logout'&&request.method==='POST')return await logout(request,stub,origin,env);
  if(path==='/v1/import/short'&&request.method==='POST')
   return await importShort(request,env,stub,origin);
  error('OAuth endpoint unavailable',405);
 }catch(e){
  const status=Number(e?.status)||500;
  return response({error:status>=500?'LOC Auth temporarily unavailable':String(e.message)},
   status,origin);
 }
}
