import {test} from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
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
