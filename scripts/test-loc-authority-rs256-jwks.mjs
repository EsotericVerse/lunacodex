import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {issueDelegation,verifyDelegationBoundary} from '../app/loc/auth/delegation-contract.mjs';

if(!globalThis.crypto)globalThis.crypto=webcrypto;
const source=readFileSync(new URL('../workers/loc-authority/index.mjs',import.meta.url),'utf8')
  .replace(/^[\s\S]*?(?=\/\/ LOC Auth is the native identity issuer)/,'')
  .replace('export class LocAuthorityState','class LocAuthorityState')
  .replace('export default {','const worker={');
const {LocAuthorityState,worker}=new Function('DurableObject','issueDelegation',
  'validateKeywordCategoryEntry','hashKeywordCategory','assertPublicKeywordClass',
  'AUTH_PROVIDER_TYPES','validateAuthProviderSettings','publicAuthProviderSettings',
  'isNativeOAuthPath','looksLikeNativeToken','checkExternalAuthQos','verifyNativeOAuth','WEB_AUDIENCE',source+'\nreturn {LocAuthorityState,worker};')(
    class {constructor(ctx,env){this.ctx=ctx;this.env=env;}},issueDelegation,
    ()=>{},()=>{},()=>{},[],()=>{},()=>{},()=>false,()=>false,async()=>null,
    async()=>{throw Object.assign(new Error('OAuth required'),{status:401});},
    'https://loc.lo3rwang.cc'
  );
const saved=new Map();
const storage={get:async key=>saved.get(key),put:async(k,v)=>saved.set(k,v),
  list:async()=>new Map(),delete:async k=>saved.delete(k)};
const ctx={storage,blockConcurrencyWhile:async action=>action()};
const env={LOC_CONTROL_ORIGIN:'https://loc.lo3rwang.cc',
  LOC_CLERK_ISSUER:'https://clerk.example.org',
  LOC_RECOVERY_ROOT_CLERK_IDS:'user_example',
  LOC_CONTROL_ENCRYPTION_KEY:Buffer.alloc(32,27).toString('base64'),
  LOC_AUTHORITY_STATE:{idFromName:name=>name,get:()=>authority}};
const authority=new LocAuthorityState(ctx,env);
const claims=issueDelegation({sub:'user_example',email:'sopa2306@gmail.com',
  grants:['global:manage'],audience:'sql',sid:'test-session',
  now:Math.floor(Date.now()/1000),seconds:300});

test('LOC Authority signs its own RS256 delegation and exports ONLY the public key',async()=>{
  const keys=await authority.delegationJwks();
  assert.equal(keys.keys.length,1);
  assert.equal(keys.keys[0].alg,'RS256');
  assert.equal(keys.keys[0].kty,'RSA');
  assert.equal(keys.keys[0].d,undefined);
  const jwt=await authority.signLocDelegation(claims);
  const parts=jwt.split('.');
  assert.equal(parts.length,3);
  const header=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));
  assert.equal(header.kid,keys.keys[0].kid);
  assert.equal(header.alg,'RS256');
  const key=await crypto.subtle.importKey('jwk',keys.keys[0],
    {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  assert.equal(await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,
    Buffer.from(parts[2],'base64url'),
    new TextEncoder().encode(parts[0]+'.'+parts[1])),true);
  const payload=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'));
  assert.equal(verifyDelegationBoundary(payload,{kind:'query'}).claims.provider,'loc');
  assert.equal(JSON.stringify([...saved.values()]).includes('privateJwk'),false);
});

test('LOC signing key survives Worker restart without rotating its kid',async()=>{
  const fresh=new LocAuthorityState(ctx,env);
  const first=await authority.delegationJwks();
  const second=await fresh.delegationJwks();
  assert.deepEqual(first,second);
});

test('JWKS is public but private signing operations are not exposed via HTTP',async()=>{
  const response=await worker.fetch(new Request('https://auth.lo3rwang.cc/.well-known/jwks.json'),env);
  assert.equal(response.status,200);
  const keys=await response.json();
  assert.equal(keys.keys[0].d,undefined);
  assert.equal(response.headers.get('cache-control'),'public, max-age=300');
  const forbidden=await worker.fetch(new Request('https://auth.lo3rwang.cc/v1/delegation'),env);
  assert.equal(forbidden.status,401);
});
