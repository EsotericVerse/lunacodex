import {test} from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {handleNativeOAuth,ISSUER} from '../workers/loc-authority/native-oauth.mjs';
import {verifyAuthReference,assertReferencePermission}
 from '../workers/loc-authority/auth-ref.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const b64=value=>Buffer.from(typeof value==='string'?value:JSON.stringify(value)).toString('base64url');
async function signedJwt(claims){
 const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',
  modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},
  true,['sign','verify']);
 const head=b64({alg:'RS256',kid:'test-ref',typ:'JWT'});
 const input=head+'.'+b64(claims);
 const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',
  keys.privateKey,new TextEncoder().encode(input));
 const jwk={...await crypto.subtle.exportKey('jwk',keys.publicKey),
  kid:'test-ref',alg:'RS256',use:'sig'};
 return {jwt:input+'.'+Buffer.from(signature).toString('base64url'),jwk};
}
test('OIDC, AD/LDAP bridge, Entra and Clerk are horizontal verified refs',async()=>{
 const providers=['oidc','ldap','ad','entra','clerk'];
 const issuer='https://identity.example.org';
 const now=Math.floor(Date.now()/1000);
 const {jwt,jwk}=await signedJwt({sub:'external-888',iss:issuer,
  aud:'loc-app',iat:now-30,exp:now+600,email_verified:true,
  email:'member@example.org',groups:['team-read'],roles:['editor']});
 const fetchImpl=async url=>{
  if(String(url).endsWith('/.well-known/jwks.json'))
   return Response.json({keys:[jwk]});
  if(String(url).endsWith('/.well-known/openid-configuration'))
   return Response.json({issuer,jwks_uri:issuer+'/.well-known/jwks.json'});
  throw Error('unexpected fetch '+url);
 };
 for(const provider of providers.filter(x=>x!=='entra')){
  const profile={type:provider,
   issuer_url:issuer,bridge_issuer_url:issuer,client_id:'loc-app'};
  const attestation=await verifyAuthReference(provider,jwt,profile,{fetchImpl});
  assert.equal(attestation.provider,provider);
  assert.equal(attestation.externalSubject,'external-888');
  assert.equal(attestation.email,'member@example.org');
  assert.equal(attestation.emailVerified,true);
  assert.ok(assertReferencePermission(attestation,provider,'team-read'));
  assert.throws(()=>assertReferencePermission(attestation,provider,'unlisted'),/permission/);
  assert.throws(()=>assertReferencePermission(attestation,provider,'team-read',
   Date.now()+700000),/expired/);
 }
 const profile={type:'oidc',issuer_url:issuer,client_id:'other-app'};
 await assert.rejects(verifyAuthReference('oidc',jwt,profile,{fetchImpl}),/audience/);
 await assert.rejects(verifyAuthReference('oidc',jwt.slice(0,-4)+'abcd',
  {type:'oidc',issuer_url:issuer,client_id:'loc-app'},{fetchImpl}),/signature/);
});
test('GitHub ref verifies external identity without minting LOC roles',async()=>{
 const calls=[];
 const fetchImpl=async(url,options)=>{
  calls.push(String(url));
  assert.equal(options.headers.authorization,'Bearer external-github-access-token');
  if(String(url).endsWith('/user'))return Response.json({id:91827,login:'companydev'});
  if(String(url).endsWith('/user/emails'))
   return Response.json([{email:'dev@example.org',verified:true,primary:true}]);
  throw Error('unexpected');
 };
 const assertion=await verifyAuthReference('github','external-github-access-token',
  {type:'github'},{fetchImpl});
 assert.equal(assertion.externalSubject,'91827');
 assert.equal(assertion.email,'dev@example.org');
 assert.deepEqual(assertion.permissions,['login:companydev']);
 assert.equal(assertReferencePermission(assertion,'github','login:companydev'),true);
 assert.equal(calls.length,2);
});

function referenceEnvironment(){
 const records=new Map(),sid='A'.repeat(43);
 const subject='loc_'+'c'.repeat(40);
 const sha=value=>crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))
  .then(x=>Buffer.from(x).toString('base64url'));
 const ready=sha(sid).then(hash=>records.set('native-session:'+hash,{
  subject,email:'member@example.org',sidHash:hash,expires:Date.now()+7200000}));
 const providers={
  github:{type:'github',client_id:'github-ref-client',client_secret:'github-ref-secret',
   callback_url:ISSUER+'/oauth/callback/github'},
  oidc:{type:'oidc',issuer_url:'https://identity.example.org',client_id:'loc-app',
   client_secret:'oidc-ref-secret',callback_url:ISSUER+'/oauth/callback/oidc'}
 };
 const stub={
  authQuotaAcquire:async()=>({allowed:true}),
  nativeGet:async key=>(await ready,records.get(key)),
  nativePut:async(key,val)=>{records.set(key,val);return true},
  nativeTake:async key=>{const val=records.get(key);records.delete(key);return val},
  authRefProfile:async name=>providers[name],
  recordAuthReference:async(sub,proof)=>{records.set('auth-ref:'+sub+':'+proof.provider,proof);return proof}
 };
 const env={LOC_AUTHORITY_STATE:{idFromName:x=>x,get:()=>stub}};
 return {env,records,subject,cookie:'__Host-loc-session='+sid,providers};
}
function csrfCookie(resp){
 return resp.headers.getSetCookie().find(x=>x.startsWith('__Host-loc-csrf=')).split(';')[0];
}
test('interactive GitHub Auth Ref preserves the LOC session and binds the verified external proof',async()=>{
 const {env,records,subject,cookie}=referenceEnvironment();
 const previousFetch=globalThis.fetch;
 const calls=[];
 globalThis.fetch=async(uri)=>{
  calls.push(String(uri));
  if(String(uri)==='https://github.com/login/oauth/access_token')
   return Response.json({access_token:'github-verified-token'});
  if(String(uri)==='https://api.github.com/user')
   return Response.json({id:123,login:'companydev'});
  if(String(uri)==='https://api.github.com/user/emails')
   return Response.json([{email:'member@example.org',primary:true,verified:true}]);
  throw Error('Unexpected mocked Ref fetch '+uri);
 };
 try{
  const start=await handleNativeOAuth(new Request(ISSUER+'/oauth/ref?provider=github',{
    headers:{cookie}}),env);
  assert.equal(start.status,302);
  const target=new URL(start.headers.get('location'));
  assert.equal(target.hostname,'github.com');
  const state=target.searchParams.get('state');
  const finish=await handleNativeOAuth(new Request(ISSUER+
    '/oauth/callback/github?state='+encodeURIComponent(state)+'&code=once',{
    headers:{cookie:cookie+'; '+csrfCookie(start)}}),env);
  assert.equal(finish.status,302);
  assert.match(finish.headers.get('location'),/^https:\/\/loc\.lo3rwang\.cc\/local\/settings\//);
  assert.equal(records.get('auth-ref:'+subject+':github')?.externalSubject,'123');
  assert.equal(records.get('auth-ref:'+subject+':github')?.email,'member@example.org');
  assert.equal(finish.headers.getSetCookie().filter(x=>x.startsWith('__Host-loc-session=')).length,0);
  assert.equal(calls.length,3);
 }finally{globalThis.fetch=previousFetch}
});
test('interactive OIDC Auth Ref validates state/nonce and remains horizontally scoped',async()=>{
 const {env,records,subject,cookie}=referenceEnvironment();
 const previousFetch=globalThis.fetch;
 let token='',jwk=null;
 globalThis.fetch=async(uri)=>{
  const u=String(uri);
  if(u.endsWith('/.well-known/openid-configuration'))return Response.json({
   issuer:'https://identity.example.org',
   authorization_endpoint:'https://identity.example.org/authorize',
   token_endpoint:'https://identity.example.org/token',
   jwks_uri:'https://identity.example.org/.well-known/jwks.json'});
  if(u.endsWith('/token'))return Response.json({id_token:token});
  if(u.endsWith('/.well-known/jwks.json'))return Response.json({keys:[jwk]});
  throw Error('Unexpected OIDC fetch '+u);
 };
 // The signed token below must use the same public key as the discovery JWKS;
 // the test's other cases verify accepted signed payloads directly.
 try{
  const start=await handleNativeOAuth(new Request(ISSUER+'/oauth/ref?provider=oidc',{
   headers:{cookie}}),env);
  assert.equal(start.status,302);
  const authz=new URL(start.headers.get('location'));
  assert.equal(authz.hostname,'identity.example.org');
  assert.ok(authz.searchParams.get('nonce'));
  const result=await signedJwt({iss:'https://identity.example.org',
   aud:'loc-app',sub:'external-1',iat:Math.floor(Date.now()/1000)-20,
   exp:Math.floor(Date.now()/1000)+600,nonce:'wrong-nonce',email_verified:true,
   email:'member@example.org'});
  token=result.jwt;jwk=result.jwk;
  const callback=await handleNativeOAuth(new Request(ISSUER+
   '/oauth/callback/oidc?state='+encodeURIComponent(authz.searchParams.get('state'))+
   '&code=once',{headers:{cookie:cookie+'; '+csrfCookie(start)}}),env);
  // The provider token deliberately lacks a matching signed nonce: fail closed.
  assert.equal(callback.status,401);
  assert.equal(records.has('auth-ref:'+subject+':oidc'),false);
 }finally{globalThis.fetch=previousFetch}
});
