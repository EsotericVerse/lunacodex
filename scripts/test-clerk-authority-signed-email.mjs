import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generateKeyPairSync,sign,webcrypto} from 'node:crypto';
const path=new URL('../workers/loc-authority/index.mjs',import.meta.url);
const source=readFileSync(path,'utf8')
  .replace("import { DurableObject } from 'cloudflare:workers';","class DurableObject {constructor(ctx,env){this.ctx=ctx;this.env=env}};")
  .replace("'../../app/loc/auth/delegation-contract.mjs'",
    JSON.stringify(new URL('../app/loc/auth/delegation-contract.mjs',import.meta.url).href))
  .replace("'./native-oauth.mjs'",
    JSON.stringify(new URL('../workers/loc-authority/native-oauth.mjs',import.meta.url).href))
  .replace("'./sql-profile.mjs'",
    JSON.stringify(new URL('../workers/loc-authority/sql-profile.mjs',import.meta.url).href))
  .replace("'./keyword-categories.mjs'",
    JSON.stringify(new URL('../workers/loc-authority/keyword-categories.mjs',import.meta.url).href))
  .replace("'../../app/loc/auth/auth-provider-settings.mjs'",
    JSON.stringify(new URL('../app/loc/auth/auth-provider-settings.mjs',import.meta.url).href));
const {default:worker}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'clerk-test-kid',alg:'RS256',use:'sig'};
const b64=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const b64bytes=value=>Buffer.from(value).toString('base64url');
const issuer='https://clerk-test.example.org',origin='https://loc.example.org';
function jwt(overrides={},headerKid=jwk.kid){
  const now=Math.floor(Date.now()/1000);
  const head=b64({alg:'RS256',kid:headerKid,typ:'JWT'});
  const payload=b64({iss:issuer,azp:origin,sub:'user_TEST123',
    sid:'sess_TEST123',iat:now,nbf:now-5,exp:now+300,
    email:'owner@example.org',email_verified:true,...overrides});
  const message=head+'.'+payload;
  return message+'.'+b64bytes(sign('RSA-SHA256',Buffer.from(message),privateKey));
}
const env={
  LOC_CLERK_ISSUER:issuer,LOC_RECOVERY_ROOT_CLERK_IDS:'user_TEST123',
  LOC_CONTROL_ORIGIN:origin,
  LOC_CONTROL_ENCRYPTION_KEY:Buffer.alloc(32).toString('base64'),
  LOC_AUTHORITY_STATE:{idFromName:()=>({}),get:()=>({})}
};
async function verified(token,{publicKey=jwk,rootEmail=''}={}){
  const previous=globalThis.fetch;
  globalThis.fetch=async(value,init)=>{
    assert.equal(String(value),issuer+'/.well-known/jwks.json');
    // Cloudflare Workers throws TypeError for redirect:'error'.
    // The mock reproduces that Worker restriction instead of silently
    // accepting a setting that a Node fetch might permit.
    if(init?.redirect==='error')throw new TypeError('Unsupported redirect mode in Cloudflare Workers');
    assert.equal(init?.redirect,'follow');
    return new Response(JSON.stringify({keys:[publicKey]}),{status:200});
  };
  try{
    const request=new Request('https://authority.example.org/v1/identity',{
      headers:{authorization:'Bearer '+token,origin}
    });
    return await worker.fetch(request,{...env,LOC_ROOT_MANAGEMENT_EMAIL:rootEmail});
  }finally{globalThis.fetch=previous}
}
test('Clerk RS256 verified email is accepted only after matching issuer, signature and origin',async()=>{
  const response=await verified(jwt());
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.email,'owner@example.org');
  assert.equal(body.subject,'user_TEST123');
});
test('unverified email never becomes a management email',async()=>{
  const response=await verified(jwt({email_verified:false}));
  assert.equal(response.status,200);
  assert.equal((await response.json()).email,'');
});
test('JWT with malicious email is not trusted without Clerk signature',async()=>{
  const token=jwt();
  const [header,payload,signature]=token.split('.');
  const altered=b64({...JSON.parse(Buffer.from(payload,'base64url').toString()),email:'hacker@example.org'});
  const response=await verified([header,altered,signature].join('.'));
  assert.equal(response.status,401);
});
test('mismatched Google/Clerk origin cannot enter management session',async()=>{
  const response=await verified(jwt({azp:'https://malicious.example'}));
  assert.equal(response.status,401);
});

test('Clerk may omit azp but must still pass signed issuer, session and origin checks',async()=>{
  const response=await verified(jwt({azp:undefined}));
  assert.equal(response.status,200);
  assert.equal((await response.json()).subject,'user_TEST123');
});
test('present azp from another origin is still rejected with a useful reason',async()=>{
  const response=await verified(jwt({azp:'https://wrong.example.org'}));
  assert.equal(response.status,401);
  assert.match((await response.json()).error,/authorized party/i);
});

test('Clerk signed JWT verifies against public RSA modulus/exponent despite extra JWK metadata',async()=>{
  const kid='clerk-metadata-example';
  const response=await verified(jwt({},kid),{publicKey:{...jwk,kid,
    key_ops:['verify'],x5c:['non-signing metadata'],x5t:'extra-metadata',
    ext:false}});
  assert.equal(response.status,200);
  assert.equal((await response.json()).subject,'user_TEST123');
});

test('unsupported Clerk JWKS key permissions fail closed with a server-side key error',async()=>{
  const kid='clerk-sign-only-example';
  const response=await verified(jwt({},kid),{publicKey:{...jwk,kid,key_ops:['sign']}});
  assert.equal(response.status,503);
  assert.match((await response.json()).error,/not usable for verification/);
});

test('a false JWT signature remains HTTP 401, not a key import error',async()=>{
  const token=jwt();
  const parts=token.split('.');
  const changed=parts[1].slice(0,-2)+'AA';
  const response=await verified([parts[0],changed,parts[2]].join('.'));
  assert.equal(response.status,401);
  assert.match((await response.json()).error,/signature invalid|Invalid token/);
});

test('single configured root maps verified Clerk subject to trusted management email',async()=>{
  const response=await verified(jwt({email:undefined,email_verified:undefined}),
    {rootEmail:'owner@example.org'});
  assert.equal(response.status,200);
  const identity=await response.json();
  assert.equal(identity.subject,'user_TEST123');
  assert.equal(identity.email,'owner@example.org');
});

test('non-root cannot gain management email by presenting another valid Clerk subject',async()=>{
  const response=await verified(jwt({sub:'user_OTHER',email:undefined,email_verified:undefined}),
    {rootEmail:'owner@example.org'});
  assert.equal(response.status,200);
  assert.equal((await response.json()).email,'');
});

test('an invalid or missing configured root email is never promoted to a management email',async()=>{
  const response=await verified(jwt({email:undefined,email_verified:undefined}),
    {rootEmail:'not-an-email'});
  assert.equal(response.status,200);
  assert.equal((await response.json()).email,'');
});
