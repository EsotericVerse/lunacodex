import {test} from 'node:test';
import assert from 'node:assert/strict';
import {locBetterAuth} from '../workers/loc-authority/better-auth-native.mjs';
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
