import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {verifyDelegationBoundary} from '../app/loc/auth/delegation-contract.mjs';
// Node has no cloudflare:workers runtime. Substitute only the DO base constructor,
// and resolve relative imports before loading the actual Worker in a data URL.
const source=readFileSync(new URL('../workers/loc-authority/index.mjs',import.meta.url),'utf8')
  .replace("import { DurableObject } from 'cloudflare:workers';",
    "class DurableObject { constructor(ctx,env){this.ctx=ctx;this.env=env;} }")
  .replace("'./keyword-categories.mjs'",
    JSON.stringify(new URL('../workers/loc-authority/keyword-categories.mjs',import.meta.url).href))
  .replace("'../../app/loc/auth/auth-provider-settings.mjs'",
    JSON.stringify(new URL('../app/loc/auth/auth-provider-settings.mjs',import.meta.url).href))
  .replace("'../../app/loc/auth/delegation-contract.mjs'",
    JSON.stringify(new URL('../app/loc/auth/delegation-contract.mjs',import.meta.url).href))
  .replace("'./native-oauth.mjs'",
    JSON.stringify(new URL('../workers/loc-authority/native-oauth.mjs',import.meta.url).href))
  .replace("'./sql-profile.mjs'",
    JSON.stringify(new URL('../workers/loc-authority/sql-profile.mjs',import.meta.url).href));
const {LocAuthorityState,default:worker}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));

function fakeStorage(){
  const map=new Map();
  return {
    async get(key){return map.get(key)},
    async put(key,value){map.set(key,value)},
    async delete(key){return map.delete(key)},
    async list({prefix}){return new Map([...map].filter(([key])=>key.startsWith(prefix)))}
  };
}
function makeControl(env){
  const data=new LocAuthorityState({storage:fakeStorage(),blockConcurrencyWhile:async callback=>callback()},env);
  env.LOC_AUTHORITY_STATE={idFromName:()=>({id:'test'}),get:()=>data};
  return data;
}
async function makeKeys(){
  const pair=await crypto.subtle.generateKey(
    {name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},
    true,['sign','verify']);
  const spki=new Uint8Array(await crypto.subtle.exportKey('spki',pair.publicKey));
  const pem='-----BEGIN PUBLIC KEY-----\n'+Buffer.from(spki).toString('base64')+'\n-----END PUBLIC KEY-----';
  return {pair,pem};
}
function b64(value){return Buffer.from(typeof value==='string'?value:JSON.stringify(value)).toString('base64url');}
async function bearer(pair,overrides={}){
  const now=Math.floor(Date.now()/1000);
  const header=b64({alg:'RS256',typ:'JWT'});
  const payload=b64({
    iss:'https://clerk.example.test',azp:'https://loc.example.test',
    sub:'user_ABC123',sid:'sess_TEST',iat:now-1,nbf:now-1,exp:now+60,...overrides
  });
  const message=header+'.'+payload;
  const signature=new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,
    new TextEncoder().encode(message)));
  return message+'.'+Buffer.from(signature).toString('base64url');
}
function envFor(pem){
  const env={
    LOC_CLERK_ISSUER:'https://clerk.example.test',
    LOC_CLERK_JWT_PUBLIC_KEY:pem,
    LOC_CONTROL_ORIGIN:'https://loc.example.test',
    LOC_RECOVERY_ROOT_CLERK_IDS:'user_ABC123',
    LOC_CONTROL_ENCRYPTION_KEY:Buffer.alloc(32,17).toString('base64')
  };
  return env;
}
function request(path,token,method='GET',body,origin='https://loc.example.test'){
  return new Request('https://control.example.test'+path,{
    method,headers:{origin,authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},
    ...(body?{body:JSON.stringify(body)}:{})
  });
}
test('independent Clerk control verifies JWT signatures + issuer + authorized party + root identity',async()=>{
  const {pair,pem}=await makeKeys(),env=envFor(pem);
  makeControl(env);
  const valid=await bearer(pair);
  const ok=await worker.fetch(request('/v1/me',valid),env);
  assert.equal(ok.status,200);
  assert.equal((await ok.json()).subject,'user_ABC123');
  for(const claims of [
    {iss:'https://wrong.example'}, {azp:'https://evil.test'},
    {sub:'user_NOROOT'}, {exp:1},{nbf:Math.floor(Date.now()/1000)+90}
  ]){
    const response=await worker.fetch(request('/v1/me',await bearer(pair,claims)),env);
    assert.ok([401,403].includes(response.status));
  }
  const mangled=valid.slice(0,-3)+'abc';
  assert.equal((await worker.fetch(request('/v1/me',mangled),env)).status,401);
  assert.equal((await worker.fetch(request('/v1/me',valid,'GET',null,'https://evil.test'),env)).status,403);
});
test('database recovery stores encrypted connection credentials outside any business database',async()=>{
  const {pair,pem}=await makeKeys(),env=envFor(pem);
  const store=makeControl(env),token=await bearer(pair);
  const profile={
    engine:'mysql',host:'db.example.test',port:3306,database:'loc',username:'locuser',
    password:'secret-value',label:'Cloud SQL MySQL'
  };
  const added=await worker.fetch(request('/v1/targets/cloudsql',token,'PUT',profile),env);
  assert.equal(added.status,200);
  assert.doesNotMatch(JSON.stringify(await added.json()),/secret-value/);
  const list=await worker.fetch(request('/v1/state',token),env);
  const state=await list.json();
  assert.equal(state.targets[0].engine,'mysql');
  assert.doesNotMatch(JSON.stringify(state),/secret-value/);
  const privateProfile=await store.getProfileForGateway('cloudsql');
  assert.equal(privateProfile.password,'secret-value');
  assert.equal((await worker.fetch(request('/v1/primary',token,'POST',{id:'cloudsql'}),env)).status,200);
  assert.equal((await store.listState()).primary_id,'cloudsql');
  const edited=await worker.fetch(request('/v1/targets/cloudsql',token,'PUT',{...profile,password:''}),env);
  assert.equal(edited.status,200);
  assert.equal((await store.getProfileForGateway('cloudsql')).password,'secret-value');
});
test('fails closed if Clerk or independent control service is unconfigured',async()=>{
  const env={LOC_CONTROL_ORIGIN:'https://loc.example.test'};
  const response=await worker.fetch(new Request('https://control.example.test/v1/state'),env);
  assert.equal(response.status,503);
  assert.equal((await response.json()).error,'Recovery control unavailable');
});

test('verified non-root identity has no Authority grants until explicitly assigned',async()=>{
  const {pair,pem}=await makeKeys(),env=envFor(pem),control=makeControl(env);
  const token=await bearer(pair,{sub:'user_NONROOT'});
  const identity=await worker.fetch(request('/v1/identity',token),env);
  assert.equal(identity.status,200);
  assert.equal((await identity.json()).subject,'user_NONROOT');
  assert.equal((await worker.fetch(request('/v1/state',token),env)).status,403);
  assert.equal(await control.mayAccess({provider:'clerk',subject:'user_NONROOT',scope:'lo3rwang',action:'write'}),false);
  const root=await bearer(pair);
  const grant={provider:'clerk',subject:'user_NONROOT',scope:'lo3rwang',actions:['read','write'],expires_at:Date.now()+3600000};
  assert.equal((await worker.fetch(request('/v1/grants',root,'PUT',grant),env)).status,200);
  assert.equal(await control.mayAccess({provider:'clerk',subject:'user_NONROOT',scope:'lo3rwang',action:'write'}),true);
  assert.equal(await control.mayAccess({provider:'clerk',subject:'user_NONROOT',scope:'lrunes',action:'write'}),false);
  assert.equal(await control.mayAccess({provider:'clerk',subject:'user_NONROOT',scope:'lo3rwang',action:'configure'}),false);
  const id='clerk:user_NONROOT:lo3rwang';
  assert.equal((await worker.fetch(request('/v1/revoke',root,'POST',{key:id}),env)).status,200);
  assert.equal(await control.mayAccess({provider:'clerk',subject:'user_NONROOT',scope:'lo3rwang',action:'write'}),false);
  const expired=await control.putGrant({...grant,expires_at:Date.now()+50});
  assert.equal(expired.scope,'lo3rwang');
  await new Promise(resolve=>setTimeout(resolve,70));
  assert.equal(await control.mayAccess({provider:'clerk',subject:'user_NONROOT',scope:'lo3rwang',action:'write'}),false);
});
test('optional secondary OIDC recovers admin access without Clerk being configured',async()=>{
  const {pair,pem}=await makeKeys();
  const env={
    LOC_SECONDARY_ISSUER:'https://oidc.example.test',
    LOC_SECONDARY_JWT_PUBLIC_KEY:pem,
    LOC_SECONDARY_AUDIENCE:'loc-recovery',
    LOC_RECOVERY_ROOT_SECONDARY_SUBJECTS:'operator_1',
    LOC_CONTROL_ORIGIN:'https://loc.example.test',
    LOC_CONTROL_ENCRYPTION_KEY:Buffer.alloc(32,33).toString('base64')
  };
  makeControl(env);
  const token=await bearer(pair,{iss:'https://oidc.example.test',sub:'operator_1',aud:'loc-recovery'});
  assert.equal((await worker.fetch(request('/v1/me',token),env)).status,200);
  const bad=await bearer(pair,{iss:'https://oidc.example.test',sub:'operator_1',aud:'untrusted'});
  assert.equal((await worker.fetch(request('/v1/me',bad),env)).status,401);
});
test('verified OAuth identity exchanges into one short LOC delegation without a SQL Auth RPC',async()=>{
  const {pair,pem}=await makeKeys(),env=envFor(pem);
  env.LOC_ROOT_MANAGEMENT_EMAIL='owner@example.org';
  makeControl(env);
  const root=await bearer(pair);
  const reply=await worker.fetch(request('/v1/delegation',root,'POST',{global:true}),env);
  assert.equal(reply.status,200);
  const item=await reply.json();
  assert.equal(item.audience,'loc-delegation');
  assert.deepEqual(item.grants,['global:manage']);
  const [header,payload,signature]=item.access_token.split('.');
  const keys=(await env.LOC_AUTHORITY_STATE.get().delegationJwks()).keys;
  const key=await crypto.subtle.importKey('jwk',keys[0],
    {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  assert.equal(await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,
    Buffer.from(signature,'base64url'),new TextEncoder().encode(header+'.'+payload)),true);
  const claims=JSON.parse(Buffer.from(payload,'base64url').toString());
  assert.equal(claims.sub,'user_ABC123','legacy Clerk owner_id must be preserved');
  assert.equal(claims.email,'owner@example.org');
  assert.equal(claims.exp-claims.iat,300);
  assert.equal(verifyDelegationBoundary(claims,{kind:'query'}).claims.me,true);
});

test('non-root OAuth cannot convert ungranted Scope or arbitrary identity into LOC authority',async()=>{
  const {pair,pem}=await makeKeys(),env=envFor(pem),control=makeControl(env);
  const client=await bearer(pair,{sub:'user_READER',email:'reader@example.org',email_verified:true});
  const rejected=await worker.fetch(request('/v1/delegation',client,'POST',
    {audience:'mcp',scopeid:'lrunes',actions:['write']}),env);
  assert.equal(rejected.status,403);
  const identityOnly=await worker.fetch(request('/v1/delegation',client,'POST',
    {audience:'sql',identity:true}),env);
  assert.equal(identityOnly.status,200);
  const minimal=await identityOnly.json();
  const basicClaims=JSON.parse(Buffer.from(minimal.access_token.split('.')[1],'base64url').toString());
  assert.deepEqual(basicClaims.grants,[]);
  assert.equal(verifyDelegationBoundary(basicClaims,{kind:'query'}).claims.me,true);
  assert.equal((await worker.fetch(request('/v1/delegation',client,'POST',
    {audience:'sql',identity:true,scopeid:'lo3rwang'}),env)).status,400);
  const myDelegations=await worker.fetch(request('/v1/delegation',client,'POST',
    {audience:'sql',self:true}),env);
  assert.equal(myDelegations.status,200);
  assert.deepEqual((await myDelegations.json()).grants,[]);
  const rootDenied=await worker.fetch(request('/v1/delegation',client,'POST',{global:true}),env);
  assert.equal(rootDenied.status,403);
  await control.putGrant({provider:'clerk',subject:'user_READER',scope:'lo3rwang',
    actions:['read'],expires_at:Date.now()+3600000});
  const accepted=await worker.fetch(request('/v1/delegation',client,'POST',
    {audience:'mcp',scopeid:'lo3rwang',actions:['read']}),env);
  assert.equal(accepted.status,200);
  const selfRead=await worker.fetch(request('/v1/delegation',client,'POST',
    {audience:'sql',self:true}),env);
  assert.equal(selfRead.status,200);
  assert.deepEqual((await selfRead.json()).grants,[]);
  const item=await accepted.json();
  assert.deepEqual(item.grants,['lo3rwang:read']);
  const claims=JSON.parse(Buffer.from(item.access_token.split('.')[1],'base64url').toString());
  assert.equal(verifyDelegationBoundary(claims,{kind:'mcp-read',scopeid:'lo3rwang'}).verifiedMcp,true);
  assert.throws(()=>verifyDelegationBoundary(claims,{kind:'query'}),/Invalid/);
  await control.revokeGrant('clerk:user_READER:lo3rwang');
  const after=await worker.fetch(request('/v1/delegation',client,'POST',
    {audience:'mcp',scopeid:'lo3rwang',actions:['read']}),env);
  assert.equal(after.status,403);
  const forged=await worker.fetch(request('/v1/delegation',client,'POST',
    {audience:'sql',scopeid:'lo3rwang',actions:['read'],sub:'user_root'}),env);
  assert.equal(forged.status,400);
});

test('manage-self exchanges only existing verified Scope management grants',async()=>{
  const {pair,pem}=await makeKeys(),env=envFor(pem),control=makeControl(env);
  const client=await bearer(pair,{sub:'user_EDITOR',
    email:'editor@example.org',email_verified:true});
  await control.putGrant({provider:'clerk',subject:'user_EDITOR',scope:'lrunes',
    actions:['manage'],expires_at:Date.now()+3600000});
  const result=await worker.fetch(request('/v1/delegation',client,'POST',
    {audience:'sql',self:true}),env);
  assert.equal(result.status,200);
  const item=await result.json();
  assert.deepEqual(item.grants,['lrunes:manage']);
  const claims=JSON.parse(Buffer.from(item.access_token.split('.')[1],'base64url').toString());
  assert.equal(claims.sub,'user_EDITOR');
  assert.equal(verifyDelegationBoundary(claims,{kind:'query'}).claims.me,true);
  await control.revokeGrant('clerk:user_EDITOR:lrunes');
  const revoked=await worker.fetch(request('/v1/delegation',client,'POST',
    {audience:'sql',self:true}),env);
  assert.equal(revoked.status,200);
  assert.deepEqual((await revoked.json()).grants,[]);
});
test('trusted manual email mapping enables delegated Scope on default Clerk JWT',async()=>{
  const {pair,pem}=await makeKeys(),env=envFor(pem),control=makeControl(env);
  const token=await bearer(pair,{sub:'user_MANUAL'});
  await control.putGrant({provider:'clerk',subject:'user_MANUAL',scope:'lo3rwang',
    actions:['manage'],email:'manual@example.org',expires_at:Date.now()+3600000});
  const result=await worker.fetch(request('/v1/delegation',token,'POST',
    {audience:'sql',scopeid:'lo3rwang',actions:['manage']}),env);
  assert.equal(result.status,200);
  const claims=JSON.parse(Buffer.from((await result.json()).access_token.split('.')[1],
    'base64url').toString());
  assert.equal(claims.sub,'user_MANUAL');
  assert.equal(claims.email,'manual@example.org');
  const self=await worker.fetch(request('/v1/delegation',token,'POST',
    {audience:'sql',self:true}),env);
  assert.equal(self.status,200);
  assert.deepEqual((await self.json()).grants,['lo3rwang:manage']);
  assert.equal((await worker.fetch(request('/v1/delegation',token,'POST',
    {audience:'sql',scopeid:'lrunes',actions:['manage']}),env)).status,403);
  await control.revokeGrant('clerk:user_MANUAL:lo3rwang');
  assert.equal((await worker.fetch(request('/v1/delegation',token,'POST',
    {audience:'sql',scopeid:'lo3rwang',actions:['manage']}),env)).status,403);
});
test('LOC delegation requires verified email, not a shared signing secret',async()=>{
  const {pair,pem}=await makeKeys(),env=envFor(pem);
  makeControl(env);
  const token=await bearer(pair);
  assert.equal((await worker.fetch(request('/v1/delegation',token,'POST',{global:true}),env)).status,403);
  env.LOC_ROOT_MANAGEMENT_EMAIL='owner@example.org';
  const success=await worker.fetch(request('/v1/delegation',token,'POST',{global:true}),env);
  assert.equal(success.status,200);
  assert.equal((await success.json()).token_type,'Bearer');
  const jwks=await worker.fetch(new Request('https://control.example.test/.well-known/jwks.json'),env);
  assert.equal(jwks.status,200);
  assert.equal((await jwks.json()).keys[0].alg,'RS256');
});
test('public sign-in uses LOC Auth, not a vendor-hosted login widget',()=>{
  const page=readFileSync(new URL('../public/login/index.html',import.meta.url),'utf8');
  const account=readFileSync(new URL('../app/loc/GlobalSettings.jsx',import.meta.url),'utf8');
  assert.match(page,/<title>LOC · 登入<\/title>/);
  assert.match(page,/const AUTHORITY='https:\/\/auth\.lo3rwang\.cc'/);
  assert.match(page,/new URL\('\/oauth\/login',AUTHORITY\)/);
  assert.match(page,/fetch\(AUTHORITY\+'\/v1\/auth\/session'/);
  assert.match(page,/id="login-root"/);
  assert.doesNotMatch(page,/clerk\.mountSignIn|ClerkProvider|loc-auth-provider|使用原本登入/);
  assert.doesNotMatch(account,/原本登入方式|恢復原本登入|獨立資料庫復原控制/);
});
test('LOC Auth login JavaScript parses and validates safe return paths',()=>{
  const login=readFileSync(new URL('../public/login/index.html',import.meta.url),'utf8');
  const script=login.split('<script type="module">')[1]?.split('</script>')[0];
  assert.ok(script);
  new Function(script);
  assert.match(script,/value\.startsWith\('\/'\)/);
  assert.match(script,/value\.startsWith\('\/\/'\)/);
  assert.match(script,/value\.includes\('\\\\'\)/);
  assert.match(script,/validReturnPath\(\)/);
  assert.match(script,/verifiedForEditor=signedIn/);
});
