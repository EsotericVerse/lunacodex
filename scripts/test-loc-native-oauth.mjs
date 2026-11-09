import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {
 ISSUER,WEB_AUDIENCE,MCP_AUDIENCE,IMPORT_AUDIENCE,
 handleNativeOAuth,verifyNativeOAuth
} from '../workers/loc-authority/native-oauth.mjs';
import {runBetterAuthStore} from '../workers/loc-authority/better-auth-store.mjs';

if(!globalThis.crypto)globalThis.crypto=webcrypto;
const encoder=new TextEncoder();
const b64=x=>Buffer.from(x instanceof Uint8Array?x:
 typeof x==='string'?x:JSON.stringify(x)).toString('base64url');

function environment(){
 const records=new Map();
 const provider={client_id:'github-app-id',client_secret:'github-app-secret',
  callback_url:'https://auth.lo3rwang.cc/oauth/callback/github'};
 let keys;
 const ready=(async()=>{
  keys=await crypto.subtle.generateKey({
   name:'RSASSA-PKCS1-v1_5',modulusLength:2048,
   publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'
  },true,['sign','verify']);
 })();
 const stub={
  async authQuotaAcquire(){return {allowed:true};},
  async nativeGet(key){return records.get(key);},
  async nativePut(key,value){records.set(key,value);},
  async nativeTake(key){const value=records.get(key);records.delete(key);return value;},
  async nativeProvider(kind){return kind==='github'?provider:null;},
  async delegationJwks(){await ready;return {keys:[{
    ...await crypto.subtle.exportKey('jwk',keys.publicKey),
    alg:'RS256',use:'sig',kid:'loc-test'
  }]};},
  async signLocDelegation(claims){
   await ready;
   const message=b64({alg:'RS256',typ:'JWT',kid:'loc-test'})+'.'+b64(claims);
   const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',
    keys.privateKey,encoder.encode(message));
   return message+'.'+b64(new Uint8Array(sig));
  },
  async mayAccess(){return false;},
  async selectedDatabaseForDelegation(){return null;}
 };
 const env={LOC_IMPORT_SCOPE_ID:'lo3rwang',
  LOC_AUTHORITY_STATE:{idFromName:x=>x,get:()=>stub}};
 return {env,stub,records};
}
function request(path,init={}){
 return new Request(ISSUER+path,{...init});
}
function fromSetCookie(reply,name){
 const all=reply.headers.getSetCookie?.()||
  [reply.headers.get('set-cookie')].filter(Boolean);
 const item=all.find(value=>value.startsWith(name+'='));
 assert.ok(item,'missing '+name+' cookie');
 return item.split(';')[0];
}
function assertStatus(reply,status){
 assert.equal(reply.status,status,'unexpected response status');
}
test('native LOC OAuth exposes PKCE-only metadata, keeps SQL resource separate',async()=>{
 const {env}=environment();
 const meta=await handleNativeOAuth(request('/.well-known/oauth-authorization-server'),env);
 assertStatus(meta,200);
 const body=await meta.json();
 assert.equal(body.issuer,ISSUER);
 assert.equal(body.registration_endpoint,ISSUER+'/oauth/register');
 assert.equal(body.revocation_endpoint,ISSUER+'/oauth/revoke');
 assert.deepEqual(body.code_challenge_methods_supported,['S256']);
 assert.equal(body.token_endpoint_auth_methods_supported[0],'none');
 assert.notEqual(MCP_AUDIENCE,IMPORT_AUDIENCE);
 assert.notEqual(WEB_AUDIENCE,IMPORT_AUDIENCE);
 const rejected=await handleNativeOAuth(request('/oauth/register',{method:'POST',
  headers:{'content-type':'application/json'},
  body:JSON.stringify({redirect_uris:['https://evil.example/callback']})}),env);
 assertStatus(rejected,400);
});

test('GitHub verified identity -> LOC cookie -> per-install PKCE -> signed token -> refresh -> delegated import',async()=>{
 const {env}=environment();
 const origin='chrome-extension://abcdefghijklmnopabcdefghijklmnop';
 const callback='https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/loc';
 const originalFetch=globalThis.fetch;
 let upstreamCalls=0,forwarded=null;
 globalThis.fetch=async(url,options={})=>{
  const address=String(url);
  if(address==='https://github.com/login/oauth/access_token')
   return Response.json({access_token:'github-mocked-token'});
  if(address==='https://api.github.com/user')
   return Response.json({id:123456,login:'owner'});
  if(address==='https://api.github.com/user/emails')
   return Response.json([{email:'sopa2306@gmail.com',verified:true,primary:true}]);
  if(address==='https://mcp.lo3rwang.cc/api/loc-native'){
   upstreamCalls++;
   forwarded={...options,body:JSON.parse(options.body)};
   return Response.json({accepted:true,id:'batch-test',articles:[]});
  }
  throw new Error('Unexpected provider or SQL fetch '+address);
 };
 try{
  const registered=await handleNativeOAuth(request('/oauth/register',{
   method:'POST',headers:{origin,'content-type':'application/json'},
   body:JSON.stringify({client_name:'LOC 彩虹橋',redirect_uris:[callback],
    token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token']})
  }),env);
  assertStatus(registered,201);
  const client=await registered.json();
  assert.match(client.client_id,/^loc-mcp-[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(client.redirect_uris,[callback]);

  const start=await handleNativeOAuth(request('/oauth/login?provider=github&return_to=%2Flocal%2Fsettings%2F'),env);
  assertStatus(start,302);
  const csrf=fromSetCookie(start,'__Host-loc-csrf');
  const authorizeProvider=new URL(start.headers.get('location'));
  assert.equal(authorizeProvider.hostname,'github.com');
  const state=authorizeProvider.searchParams.get('state');

  const finish=await handleNativeOAuth(request('/oauth/callback/github?state='+
   encodeURIComponent(state)+'&code=provider-code',{headers:{cookie:csrf}}),env);
  assertStatus(finish,302);
  assert.match(finish.headers.get('location'),/^https:\/\/loc\.lo3rwang\.cc\/login\//);
  const cookie=fromSetCookie(finish,'__Host-loc-session');
  const signedIn=await handleNativeOAuth(request('/v1/auth/session',{
   headers:{cookie,origin:WEB_AUDIENCE}}),env);
  assertStatus(signedIn,200);
  const profile=await signedIn.json();
  assert.equal(profile.provider,'loc');
  assert.match(profile.user.id,/^loc_[A-Za-z0-9_-]{40}$/);
  assert.equal(profile.user.email,'sopa2306@gmail.com');
  const webIdentity=await verifyNativeOAuth(request('/v1/delegation',{
   headers:{authorization:'Bearer '+profile.session.access_token}}),env,WEB_AUDIENCE);
  assert.equal(webIdentity.subject,profile.user.id);
  await assert.rejects(verifyNativeOAuth(request('/v1/mcp/quota',{
   headers:{authorization:'Bearer '+profile.session.access_token}}),env,MCP_AUDIENCE),
   error=>error.status===401);

  const verifier='A'.repeat(64);
  const challenge=b64(new Uint8Array(await crypto.subtle.digest('SHA-256',
   encoder.encode(verifier))));
  const query=new URLSearchParams({response_type:'code',client_id:client.client_id,
   redirect_uri:callback,code_challenge:challenge,code_challenge_method:'S256',
   state:'test-state-0123456789abcdef',scope:'loc:import offline_access',
   resource:IMPORT_AUDIENCE});
  const authorized=await handleNativeOAuth(request('/oauth/authorize?'+query,
   {headers:{cookie}}),env);
  assertStatus(authorized,302);
  const returned=new URL(authorized.headers.get('location'));
  assert.equal(returned.origin,new URL(callback).origin);
  assert.equal(returned.searchParams.get('state'),'test-state-0123456789abcdef');
  const code=returned.searchParams.get('code');
  const form=new URLSearchParams({grant_type:'authorization_code',
   client_id:client.client_id,code,redirect_uri:callback,
   code_verifier:verifier,resource:IMPORT_AUDIENCE});
  const token=await handleNativeOAuth(request('/oauth/token',{
   method:'POST',headers:{origin,'content-type':'application/x-www-form-urlencoded'},
   body:form.toString()}),env);
  assertStatus(token,200);
  const minted=await token.json();
  assert.equal(minted.expires_in,600);
  const identity=await verifyNativeOAuth(request('/v1/import/short',{
   headers:{authorization:'Bearer '+minted.access_token}}),env,IMPORT_AUDIENCE);
  assert.equal(identity.subject,profile.user.id);
  const used=await handleNativeOAuth(request('/oauth/token',{
   method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
   body:form.toString()}),env);
  assertStatus(used,401);

  const refreshForm=new URLSearchParams({grant_type:'refresh_token',
   client_id:client.client_id,refresh_token:minted.refresh_token});
  const rotated=await handleNativeOAuth(request('/oauth/token',{
   method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
   body:refreshForm.toString()}),env);
  assertStatus(rotated,200);
  const next=await rotated.json();
  assert.notEqual(next.refresh_token,minted.refresh_token);
  assertStatus(await handleNativeOAuth(request('/oauth/token',{
   method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
   body:refreshForm.toString()}),env),401);

  const batch={id:'batch-test',write_mode:'append',records:[]};
  const send=()=>request('/v1/import/short',{method:'POST',
   headers:{origin,authorization:'Bearer '+next.access_token,
    'content-type':'application/json'},body:JSON.stringify(batch)});
  // Only the verified LOC owner may write, without Root subject or Scope grants.
  const imported=await handleNativeOAuth(send(),env);
  assertStatus(imported,200);
  assert.equal((await imported.json()).accepted,true);
  assert.equal(upstreamCalls,1);
  assert.deepEqual(forwarded.body,{kind:'short-import',scopeid:'lo3rwang',batch});
  const signed=forwarded.headers.authorization.slice('Bearer '.length);
  const claims=JSON.parse(Buffer.from(signed.split('.')[1],'base64url').toString());
  assert.equal(claims.iss,'loc');
  assert.equal(claims.aud,'loc-delegation');
  assert.equal(claims.sub,profile.user.id);
  assert.deepEqual(claims.grants,['lo3rwang:write']);
  // The optional exact Scope target must still use the existing LOC grant.
  const other=await handleNativeOAuth(request('/v1/import/short?scopeid=lrunes',{
   method:'POST',headers:{origin,authorization:'Bearer '+next.access_token,
    'content-type':'application/json'},body:JSON.stringify(batch)}),env);
  assertStatus(other,200);
  assert.equal(forwarded.body.scopeid,'lrunes');
  const otherClaims=JSON.parse(Buffer.from(forwarded.headers.authorization.split('.')[1],'base64url').toString());
  assert.deepEqual(otherClaims.grants,['lrunes:write']);
  const invalidScope=await handleNativeOAuth(request('/v1/import/short?scopeid=bad_scope',{
   method:'POST',headers:{origin,authorization:'Bearer '+next.access_token,
    'content-type':'application/json'},body:JSON.stringify(batch)}),env);
  assertStatus(invalidScope,503);


  const revoked=await handleNativeOAuth(request('/oauth/revoke',{
   method:'POST',headers:{origin,'content-type':'application/x-www-form-urlencoded'},
   body:new URLSearchParams({client_id:client.client_id,
    token:next.refresh_token,token_type_hint:'refresh_token'}).toString()
  }),env);
  assertStatus(revoked,200);
  assertStatus(await handleNativeOAuth(request('/oauth/token',{
   method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
   body:new URLSearchParams({grant_type:'refresh_token',client_id:client.client_id,
    refresh_token:next.refresh_token}).toString()
  }),env),401);
  assertStatus(await handleNativeOAuth(request('/oauth/logout',{
   method:'POST',headers:{origin:WEB_AUDIENCE,cookie}}),env),200);
  await assert.rejects(verifyNativeOAuth(request('/v1/import/short',{
   headers:{authorization:'Bearer '+next.access_token}}),env,IMPORT_AUDIENCE),
   error=>error.status===401);
 }finally{globalThis.fetch=originalFetch;}
});

test('Google provider fails closed when this Worker has no Google Client credentials',async()=>{
 const {env}=environment();
 const response=await handleNativeOAuth(request('/oauth/login?provider=google'),env);
 assertStatus(response,503);
 assert.notEqual(response.headers.get('location')?.includes('supabase.co'),true);
});
test('Google OAuth starts on LOC Better Auth with the exact Google callback',async()=>{
 const {env,stub}=environment();
 const records=new Map();
 const storage={
  async get(key){return records.get(key)},
  async put(key,value){records.set(key,value)},
  async delete(key){records.delete(key)},
  async list({prefix}){return new Map([...records].filter(([key])=>key.startsWith(prefix)))},
  async transaction(action){return action(this)}
 };
 stub.betterAuthStorage=args=>runBetterAuthStore(storage,args);
 env.LOC_CONTROL_ENCRYPTION_KEY=Buffer.alloc(32,42).toString('base64');
 env.LOC_GOOGLE_CLIENT_ID='loc-test.apps.googleusercontent.com';
 env.LOC_GOOGLE_CLIENT_SECRET='test-client-secret';
 const begin=await handleNativeOAuth(request('/oauth/login?provider=google&return_to=%2Flocal%2Fsettings%2F'),env);
 assertStatus(begin,302);
 const target=new URL(begin.headers.get('location'));
 assert.equal(target.hostname,'accounts.google.com');
 assert.equal(target.searchParams.get('client_id'),env.LOC_GOOGLE_CLIENT_ID);
 assert.equal(target.searchParams.get('redirect_uri'),ISSUER+'/api/auth/callback/google');
 assert.equal(target.searchParams.get('response_type'),'code');
 assert.ok(fromSetCookie(begin,'__Host-loc-csrf'));
 const loginState=fromSetCookie(begin,'__Host-loc-csrf');
 const reused=await handleNativeOAuth(request('/oauth/complete?state=invalid',{
  headers:{cookie:loginState}}),env);
 assertStatus(reused,401);
});

test('retired Supabase Auth callback cannot establish a LOC session',async()=>{
 const {env}=environment();
 const legacy=await handleNativeOAuth(request('/oauth/callback/supabase',{
  method:'POST',headers:{'content-type':'application/json'},body:'{}'
 }),env);
 assertStatus(legacy,405);
});
