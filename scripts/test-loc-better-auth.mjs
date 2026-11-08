import {test} from 'node:test';
import assert from 'node:assert/strict';
import {locBetterAuth} from '../workers/loc-authority/better-auth-native.mjs';
import {handleNativeOAuth,ISSUER,IMPORT_AUDIENCE,WEB_AUDIENCE} from '../workers/loc-authority/native-oauth.mjs';
import {runBetterAuthStore} from '../workers/loc-authority/better-auth-store.mjs';

class FakeStorage {
 constructor(){this.records=new Map();}
 async get(key){return this.records.get(key);}
 async put(key,value){this.records.set(key,value);}
 async delete(key){this.records.delete(key);}
 async list({prefix}){return new Map([...this.records].filter(([k])=>k.startsWith(prefix)));}
 async transaction(fn){return fn(this);}
}
function fixture(){
 const storage=new FakeStorage();
 const stub={betterAuthStorage:args=>runBetterAuthStore(storage,args)};
 const env={LOC_CONTROL_ENCRYPTION_KEY:Buffer.alloc(32,42).toString('base64'),
  LOC_AUTHORITY_STATE:{idFromName:value=>value,get:()=>stub}};
 const auth=locBetterAuth(env);
 const origin='https://auth.lo3rwang.cc';
 const req=(path,body,cookie='')=>new Request(origin+path,{
  method:body?'POST':'GET',headers:{
   ...(body?{'content-type':'application/json'}:{}),
   ...(cookie?{cookie}:{})},
  ...(body?{body:JSON.stringify(body)}:{})
 });
 return {auth,req,storage,env};
}
test('Better Auth registers, rejects duplicate and incorrect password, restores session',async()=>{
 const {auth,req,storage}=fixture();
 const signup=await auth.handler(req('/api/auth/sign-up/email',{
  name:'Native Member',email:'member@example.org',password:'very-strong-passphrase'
 }));
 const b=await signup.json().catch(()=>({}));
 assert.equal(signup.status,200,JSON.stringify(b));
 assert.ok(b.user?.id);
 assert.equal(b.user.emailVerified,false);
 const cookies=signup.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
 assert.match(cookies,/better-auth.session_token/);
 const session=await auth.handler(req('/api/auth/get-session',null,cookies));
 const data=await session.json();
 assert.equal(data?.user?.id,b.user.id);
 assert.equal(data?.user?.email,'member@example.org');
 const duplicate=await auth.handler(req('/api/auth/sign-up/email',{
  name:'Second',email:'member@example.org',password:'very-strong-passphrase'
 }));
 assert.notEqual(duplicate.status,200);
 const bad=await auth.handler(req('/api/auth/sign-in/email',{
  email:'member@example.org',password:'incorrect-passphrase'
 }));
 assert.notEqual(bad.status,200);
 const good=await auth.handler(req('/api/auth/sign-in/email',{
  email:'member@example.org',password:'very-strong-passphrase'
 }));
 assert.equal(good.status,200,await good.text());
 assert.equal([...storage.records.keys()].filter(k=>k.startsWith('loc-better-auth:user:')).length,1);
});
test('DO adapter never runs SQL or DDL and enforces data bounds',async()=>{
 const s=new FakeStorage();
 const first=await runBetterAuthStore(s,{operation:'create',model:'user',
  data:{id:'a',email:'alice@example.org',createdAt:new Date()}});
 assert.equal(first.id,'a');
 await assert.rejects(()=>runBetterAuthStore(s,{operation:'create',model:'user',
  data:{id:'b',email:'Alice@Example.org'}}),/already registered/);
 await assert.rejects(()=>runBetterAuthStore(s,{operation:'deleteMany',model:'user'}),/unbounded/);
 assert.equal((await runBetterAuthStore(s,{operation:'findOne',model:'user',
  where:[{field:'email',value:'alice@example.org'}]})).id,'a');
});

test('native credentials become LOC OAuth Session without GitHub and keep unverified email unprivileged',async()=>{
 const {auth,req,env,storage}=fixture();
 const stub={
  betterAuthStorage:args=>runBetterAuthStore(storage,args),
  authQuotaAcquire:async()=>({allowed:true}),
  nativeGet:key=>storage.get(key),nativePut:(key,val)=>storage.put(key,val),
  nativeTake:async key=>{const value=await storage.get(key);await storage.delete(key);return value},
  signLocDelegation:async claims=>JSON.stringify(claims)
 };
 env.LOC_AUTHORITY_STATE.get=()=>stub;
 const signedUp=await auth.handler(req('/api/auth/sign-up/email',{
  name:'Independent User',email:'independent@example.org',password:'independent-pass-2026'
 }));
 assert.equal(signedUp.status,200,await signedUp.text());
 const cookies=signedUp.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
 const session=await handleNativeOAuth(new Request(ISSUER+'/v1/auth/session',{
  headers:{cookie:cookies}}),env);
 assert.equal(session.status,200);
 const value=await session.json();
 assert.match(value.user.id,/^loc_[A-Za-z0-9_-]{40}$/);
 assert.equal(value.user.email,'independent@example.org');
 assert.equal(value.user.emailVerified,false);
 assert.equal(JSON.parse(value.session.access_token).email_verified,false);
 const locCookie=session.headers.getSetCookie().find(x=>x.startsWith('__Host-loc-session='));
 assert.ok(locCookie);
 const verifier='A'.repeat(64),challenge=Buffer.from(
  await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))).toString('base64url');
 const redirectUri='https://hiaeafonocnjaclcfgjmdopbcgnafnna.chromiumapp.org/loc';
 const params=new URLSearchParams({response_type:'code',
  client_id:WEB_AUDIENCE+'/extension/oauth/client.json',
  redirect_uri:redirectUri,code_challenge:challenge,code_challenge_method:'S256',
  state:'test-long-oauth-state-abcdefghij',scope:'loc:import offline_access',
  resource:IMPORT_AUDIENCE});
 const chooser=await handleNativeOAuth(new Request(ISSUER+'/oauth/authorize?'+params),env);
 assert.equal(chooser.status,302);
 assert.match(chooser.headers.get('location'),/^https:\/\/loc\.lo3rwang\.cc\/login\/index\.html/);
 assert.doesNotMatch(chooser.headers.get('location'),/github\.com/);
 const native=await handleNativeOAuth(new Request(ISSUER+'/oauth/authorize?'+params,
  {headers:{cookie:cookies}}),env);
 assert.equal(native.status,302);
 assert.match(native.headers.get('location'),/^\/oauth\/authorize\?/);
 assert.ok(native.headers.get('set-cookie')?.includes('__Host-loc-session'));
 const completed=await handleNativeOAuth(new Request(ISSUER+'/oauth/authorize?'+params,
  {headers:{cookie:locCookie.split(';')[0]}}),env);
 assert.equal(completed.status,302);
 assert.ok(completed.headers.get('location').startsWith(redirectUri));
 const out=await handleNativeOAuth(new Request(ISSUER+'/oauth/logout',{
  method:'POST',headers:{cookie:cookies+'; '+locCookie.split(';')[0]}}),env);
 assert.equal(out.status,200);
 assert.ok(out.headers.getSetCookie().some(x=>x.startsWith('__Host-loc-session=')));
});

test('indexed Session and email lookups avoid scanning all Auth records',async()=>{
 const storage=new FakeStorage(),list=storage.list.bind(storage);
 let scans=0;
 storage.list=async(...args)=>{scans++;return list(...args)};
 const first={id:'s1',userId:'user1',token:'signed-cookie-1',
  expiresAt:new Date(Date.now()+7200000)};
 const second={id:'s2',userId:'user2',token:'signed-cookie-2',
  expiresAt:new Date(Date.now()+7200000)};
 await runBetterAuthStore(storage,{operation:'create',model:'session',data:first});
 await runBetterAuthStore(storage,{operation:'create',model:'session',data:second});
 assert.equal(scans,0,'creating sessions must not scan all existing sessions');
 const record=await runBetterAuthStore(storage,{operation:'findOne',model:'session',
  where:[{field:'token',value:'signed-cookie-1'}]});
 assert.equal(record.id,'s1');
 assert.equal(scans,0,'session token index should make login lookup direct');
 const result=await runBetterAuthStore(storage,{operation:'update',model:'session',
  where:[{field:'token',value:'signed-cookie-1'}],update:{token:'rotated-1'}});
 assert.equal(result.token,'rotated-1');
 assert.equal(await runBetterAuthStore(storage,{operation:'findOne',model:'session',
  where:[{field:'token',value:'signed-cookie-1'}]}),null);
 assert.equal((await runBetterAuthStore(storage,{operation:'findOne',model:'session',
  where:[{field:'token',value:'rotated-1'}]})).id,'s1');
 await runBetterAuthStore(storage,{operation:'delete',model:'session',
  where:[{field:'token',value:'rotated-1'}]});
 assert.equal(await runBetterAuthStore(storage,{operation:'findOne',model:'session',
  where:[{field:'token',value:'rotated-1'}]}),null);
 assert.equal(scans,0);
});
