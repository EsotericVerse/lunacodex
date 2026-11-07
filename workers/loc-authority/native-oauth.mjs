import {issueDelegation} from '../../app/loc/auth/delegation-contract.mjs';

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
const SESSION_SECONDS=30*86400,ACCESS_SECONDS=600,REFRESH_SECONDS=30*86400;
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
 if(id===EXT_CLIENT)return {kind:'extension',client_id:id,redirect_uris:[EXT_REDIRECT]};
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
async function sessionFromCookie(request,stub){
 const token=parseCookies(request).get(SESSION_COOKIE);
 if(!CODE_PATTERN.test(String(token||'')))return null;
 return sessionForHash(stub,await sha(token));
}
async function issueToken(stub,session,resource,scope,client_id){
 const iat=Math.floor(Date.now()/1000);
 return {access_token:await stub.signLocDelegation({iss:ISSUER,sub:session.subject,
   aud:resource,scope,client_id,sid:session.sidHash,
   email:session.email,email_verified:true,iat,nbf:iat-5,
   exp:iat+ACCESS_SECONDS,jti:crypto.randomUUID()}),
  token_type:'Bearer',expires_in:ACCESS_SECONDS,scope};
}
export function isNativeOAuthPath(path){
 return path==='/.well-known/oauth-authorization-server'||path==='/oauth/register'||
  path==='/oauth/authorize'||path==='/oauth/login'||path==='/oauth/token'||
  path==='/oauth/revoke'||
  path==='/oauth/callback/github'||path==='/oauth/callback/oidc'||
  path==='/oauth/logout'||path==='/v1/auth/session'||path==='/v1/import/short';
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
  !CODE_PATTERN.test(String(claims.sid||''))||claims.email_verified!==true||
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
 if(!session||session.subject!==claims.sub||session.email!==claims.email)
   error('LOC OAuth session revoked',401);
 return {provider:'loc',subject:session.subject,email:session.email,
  session:session.sidHash,scope:String(claims.scope||''),client_id:claims.client_id};
}
async function authorize(request,url,stub){
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
 const session=await sessionFromCookie(request,stub);
 if(!session){
  const next=new URL('/oauth/login',ISSUER);
  next.searchParams.set('provider','github');
  next.searchParams.set('continue',url.pathname+url.search);
  return redirect(next.href);
 }
 const code=random();
 await put(stub,'native-code',code,{sidHash:session.sidHash,client_id:client.client_id,
  redirect_uri,scope,resource,challenge,expires:Date.now()+300000});
 const result=new URL(redirect_uri);result.searchParams.set('code',code);
 result.searchParams.set('state',state);result.searchParams.set('iss',ISSUER);
 return redirect(result.href);
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
 const r=await fetch(url,{...options,redirect:'error',
  signal:AbortSignal.timeout(8000)});
 if(!r.ok)error('External identity provider unavailable',502);
 return r.json().catch(()=>error('Invalid identity provider response',502));
}
async function login(url,stub){
 const name=url.searchParams.get('provider')||'github';
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
async function callback(request,url,stub,name){
 const state=url.searchParams.get('state')||'',code=url.searchParams.get('code')||'';
 if(!CODE_PATTERN.test(state)||!code||code.length>2000)
  error('Invalid OAuth callback',401);
 const pending=await take(stub,'native-login',state);
 const csrf=parseCookies(request).get(CSRF_COOKIE);
 if(!pending||pending.provider!==name||pending.expires<Date.now()||
  !csrf||await sha(csrf)!==pending.csrfHash)
  error('OAuth CSRF validation failed',401);
 const config=await provider(stub,name);
 const identity=name==='github'?await github(config,code):await oidc(config,code,pending.nonce);
 const subject='loc_'+(await sha(identity.provider+':'+identity.id)).slice(0,40);
 const sid=random(),sidHash=await sha(sid);
 const session={subject,provider:'loc',identityProvider:identity.provider,
  email:identity.email,sidHash,expires:Date.now()+SESSION_SECONDS*1000};
 await stub.nativePut('native-session:'+sidHash,session);
 const dest=pending.continue_path?ISSUER+pending.continue_path:
  WEB_AUDIENCE+'/login/index.html?return_to='+encodeURIComponent(pending.return_to);
 return redirect(dest,[cookie(SESSION_COOKIE,sid,SESSION_SECONDS),cookie(CSRF_COOKIE,'',0)]);
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
async function session(request,stub,origin){
 const identity=await sessionFromCookie(request,stub);
 if(!identity)return response({session:null,user:null},200,origin);
 const auth=await issueToken(stub,identity,WEB_AUDIENCE,'profile email','loc-web');
 const user={id:identity.subject,email:identity.email};
 return response({session:{...auth,user,expires_at:Math.floor(Date.now()/1000)+ACCESS_SECONDS},
  user,provider:'loc'},200,origin);
}
async function logout(request,stub,origin){
 const csrf=String(request.headers.get('origin')||'');
 if(csrf&&csrf!==WEB_AUDIENCE&&csrf!==ISSUER)error('Cross-origin logout forbidden',403);
 const sid=parseCookies(request).get(SESSION_COOKIE);
 if(sid&&CODE_PATTERN.test(sid))await stub.nativeTake('native-session:'+await sha(sid));
 return response({signed_out:true},200,origin,{'set-cookie':cookie(SESSION_COOKIE,'',0)});
}
async function importShort(request,env,stub,origin){
 const identity=await verifyNativeOAuth(request,env,IMPORT_AUDIENCE);
 if(!identity.scope.split(/\s+/).includes('loc:import'))error('Import scope required',403);
 const scope=String(env.LOC_IMPORT_SCOPE_ID||'lo3rwang');
 if(!SCOPE_ID.test(scope))error('Import Scope invalid',503);
 const roots=String(env.LOC_RECOVERY_ROOT_LOC_SUBJECTS||'').split(/[\s,;]+/).filter(Boolean);
 if(!roots.includes(identity.subject)&&
  !await stub.mayAccess({provider:'loc',subject:identity.subject,scope,action:'write'}))
  error('LOC Scope write permission required',403);
 const raw=await request.text();
 if(TXT.encode(raw).length>1048576)error('Import batch too large',413);
 let batch;try{batch=JSON.parse(raw);}catch{error('Invalid import JSON');}
 if(!batch||typeof batch!=='object'||Array.isArray(batch))
  error('Invalid import batch');
 const endpoint=new URL(String(env.LOC_SQL_GATEWAY_URL||'https://invalid.invalid'));
 if(endpoint.protocol!=='https:'||endpoint.hostname==='invalid.invalid'||
  endpoint.username||endpoint.password||endpoint.search||endpoint.hash||
  endpoint.pathname!=='/v1/sql')error('Independent SQL Gateway missing',503);
 const now=Math.floor(Date.now()/1000);
 const selectedTarget=await stub.selectedDatabaseForDelegation(identity.subject,
  roots.includes(identity.subject));
 const delegation=issueDelegation({sub:identity.subject,email:identity.email,
  grants:[scope+':write'],audience:'sql',sid:crypto.randomUUID(),now,seconds:300,
  targetId:selectedTarget});
 const signed=await stub.signLocDelegation(delegation);
 const upstream=await fetch(endpoint.href,{method:'POST',
  headers:{authorization:'Bearer '+signed,'content-type':'application/json'},
  body:JSON.stringify({kind:'short-import',scopeid:scope,batch}),
  signal:AbortSignal.timeout(25000),redirect:'error'});
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
  const stub=authority(env),path=url.pathname;
  if(path==='/.well-known/oauth-authorization-server'&&request.method==='GET')
   return response({issuer:ISSUER,authorization_endpoint:ISSUER+'/oauth/authorize',
    token_endpoint:ISSUER+'/oauth/token',revocation_endpoint:ISSUER+'/oauth/revoke',
    registration_endpoint:ISSUER+'/oauth/register',
    jwks_uri:ISSUER+'/.well-known/jwks.json',
    response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],
    code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none'],
    scopes_supported:['profile','email','offline_access','loc:import'],
    resource_parameter_supported:true},200,origin);
  if(path==='/oauth/register'&&request.method==='POST')return register(request,stub,origin);
  if(path==='/oauth/authorize'&&request.method==='GET')return authorize(request,url,stub);
  if(path==='/oauth/login'&&request.method==='GET')return login(url,stub);
  if(path==='/oauth/callback/github'&&request.method==='GET')
   return callback(request,url,stub,'github');
  if(path==='/oauth/callback/oidc'&&request.method==='GET')
   return callback(request,url,stub,'oidc');
  if(path==='/oauth/token'&&request.method==='POST')return token(request,stub,origin);
  if(path==='/oauth/revoke'&&request.method==='POST')return revoke(request,stub,origin);
  if(path==='/v1/auth/session'&&request.method==='GET')return session(request,stub,origin);
  if(path==='/oauth/logout'&&request.method==='POST')return logout(request,stub,origin);
  if(path==='/v1/import/short'&&request.method==='POST')
   return importShort(request,env,stub,origin);
  error('OAuth endpoint unavailable',405);
 }catch(e){
  const status=Number(e?.status)||500;
  return response({error:status>=500?'LOC Auth temporarily unavailable':String(e.message)},
   status,origin);
 }
}
