import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {trustedSqlProfile} from '../workers/loc-authority/sql-profile.mjs';
import {issueDelegation} from '../app/loc/auth/delegation-contract.mjs';

if(!globalThis.crypto)globalThis.crypto=webcrypto;
const subject='loc_'+'A'.repeat(40),serviceKey='s'.repeat(43);
const toB64=value=>Buffer.from(value instanceof Uint8Array?value:
 typeof value==='string'?value:JSON.stringify(value)).toString('base64url');
async function fixture(){
 const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',
  modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),
  hash:'SHA-256'},true,['sign','verify']);
 const publicKey=await crypto.subtle.exportKey('jwk',pair.publicKey);
 const jwks={keys:[{...publicKey,alg:'RS256',kid:'loc-profile-test'}]};
 let authorized=true;
 const stub={
  async delegationJwks(){return jwks;},
  async verifyLiveDatabaseSelection(sub,id,root){
   assert.equal(sub,subject);assert.equal(id,'azure_sql_test');
   assert.equal(root,true);return authorized;
  },
  async getProfileForGateway(id){
   assert.equal(id,'azure_sql_test');
   return {engine:'mssql',host:'db.example.org',port:1433,
    database:'loc',username:'user',password:'server-only-test'};
  }
 };
 const now=Math.floor(Date.now()/1000);
 const claims=issueDelegation({sub:subject,email:'test@example.org',
  grants:['lo3rwang:read'],audience:'sql',targetId:'azure_sql_test',
  sid:'test-sid-0001',now,seconds:300});
 const message=toB64({alg:'RS256',typ:'JWT',kid:'loc-profile-test'})+'.'+toB64(claims);
 const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',
  pair.privateKey,new TextEncoder().encode(message));
 const token=message+'.'+toB64(new Uint8Array(signature));
 const env={LOC_SQL_GATEWAY_SERVICE_KEY:serviceKey,
  LOC_RECOVERY_ROOT_LOC_SUBJECTS:subject};
 const request=(overrides={})=>new Request('https://auth.lo3rwang.cc/v1/sql/runtime-profile',{
  method:'POST',
  headers:{authorization:'Bearer '+token,
   'x-loc-sql-service-key':serviceKey,
   'content-type':'application/json',...overrides.headers},
  body:JSON.stringify({id:'azure_sql_test',...overrides.body})
 });
 return {stub,env,request,deny(){authorized=false;}};
}
test('only the gateway service with a signed selected target obtains decrypted profile',async()=>{
 const {stub,env,request}=await fixture();
 const reply=await trustedSqlProfile(request(),env,stub);
 assert.equal(reply.status,200);
 assert.equal(reply.headers.get('cache-control'),'no-store');
 const payload=await reply.json();
 assert.equal(payload.id,'azure_sql_test');
 assert.equal(payload.profile.engine,'mssql');
 assert.equal(payload.profile.password,'server-only-test');
});
test('wrong service credential, browser Origin and token mismatch reveal nothing',async()=>{
 const {stub,env,request}=await fixture();
 await assert.rejects(trustedSqlProfile(request({headers:{
  'x-loc-sql-service-key':'t'.repeat(43)}}),env,stub),error=>error.status===403);
 await assert.rejects(trustedSqlProfile(request({headers:{
  origin:'https://loc.lo3rwang.cc'}}),env,stub),error=>error.status===403);
 await assert.rejects(trustedSqlProfile(request({body:{id:'another'}}),env,stub),
  error=>error.status===403||error.status===400);
});
test('revoking a user database selection blocks existing signed tokens immediately',async()=>{
 const {stub,env,request,deny}=await fixture();deny();
 await assert.rejects(trustedSqlProfile(request(),env,stub),error=>error.status===403);
});
