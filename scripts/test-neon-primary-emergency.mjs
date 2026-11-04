import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {preferredDatabasePrimary,setEmergencyDatabasePrimary} from '../app/loc/providers/emergency-primary.mjs';
import {DATABASE_ROUTING_CONFIG,resolveDatabaseRouting} from '../app/loc/providers/routing-config.mjs';
import {createNeonPrimaryAdapter} from '../app/loc/providers/neon-primary.mjs';
import {createDatabaseClient} from '../app/loc/db-contract.mjs';

const api='https://ep-test.apirest.c-4.ap-southeast-1.aws.neon.tech/neondb/rest/v1';
const auth='https://ep-test.neonauth.c-4.ap-southeast-1.aws.neon.tech/neondb/auth';
const jwt='eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ0ZXN0In0.signature';
function simulatedNetwork({google=true,loggedIn=true}={}){
  const calls=[];
  const fetchImpl=async(input,init={})=>{
    const url=String(input);
    calls.push({url,headers:new Headers(init.headers),credentials:init.credentials});
    let payload;
    if(url===auth+'/get-session')
      payload=loggedIn?{user:{id:'verified-neon-user',email:'owner@example.com',emailVerified:true},session:{id:'session-1'}}:null;
    else if(url===auth+'/token')payload={token:jwt};
    else if(url===auth+'/list-accounts')payload=google?[{providerId:'google',accountId:'google-id'}]:[];
    else if(url===auth+'/sign-in/social')payload={url:'https://accounts.google.com/auth'};
    else if(url===auth+'/sign-out')payload={success:true};
    else if(url.startsWith(api))payload=url.includes('/rpc/')?[{id:'lo3rwang',email:'owner@example.com',role:'scope'}]:[{uid:'aB12cD34'}];
    else throw Error('Unexpected request '+url);
    return new Response(JSON.stringify(payload),{status:200,headers:{'content-type':'application/json'}});
  };
  return {fetchImpl,calls};
}
test('local emergency selection works without contacting either SQL database',()=>{
  const memory=new Map();
  const storage={getItem:key=>memory.get(key),setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)};
  const priorApi=process.env.NEXT_PUBLIC_LOC_NEON_DATA_API_URL,priorAuth=process.env.NEXT_PUBLIC_LOC_NEON_AUTH_URL;
  try{
    process.env.NEXT_PUBLIC_LOC_NEON_DATA_API_URL=api;
    process.env.NEXT_PUBLIC_LOC_NEON_AUTH_URL=auth;
    assert.equal(preferredDatabasePrimary(storage),'supabase-current');
    setEmergencyDatabasePrimary('neon-current',storage);
    assert.equal(preferredDatabasePrimary(storage),'neon-current');
    const route=resolveDatabaseRouting({...DATABASE_ROUTING_CONFIG,primaryId:'neon-current',backupId:null});
    assert.equal(route.provider,'neon');
    assert.equal(route.primaryControl,true);
    assert.equal(route.backupId,null);
    setEmergencyDatabasePrimary('supabase-current',storage);
    assert.equal(preferredDatabasePrimary(storage),'supabase-current');
  }finally{
    if(priorApi===undefined)delete process.env.NEXT_PUBLIC_LOC_NEON_DATA_API_URL;
    else process.env.NEXT_PUBLIC_LOC_NEON_DATA_API_URL=priorApi;
    if(priorAuth===undefined)delete process.env.NEXT_PUBLIC_LOC_NEON_AUTH_URL;
    else process.env.NEXT_PUBLIC_LOC_NEON_AUTH_URL=priorAuth;
  }
});
test('Neon OAuth identity, management RPC and article reads never call Supabase',async()=>{
  const {fetchImpl,calls}=simulatedNetwork();
  const adapter=createNeonPrimaryAdapter({url:api,authUrl:auth,fetchImpl,navigate:()=>{}});
  const db=createDatabaseClient(adapter);
  const original=globalThis.window;
  try{
    globalThis.window={location:{origin:'https://loc.lo3rwang.cc'}};
    // Neon Auth may work as an external provider, but cannot be promoted
    // into LOC permissions until a verified Authority adapter is enabled.
    await assert.rejects(db.getAccountSession(),/verified identity provider is required/);
    const login=await adapter.auth.getSession();
    assert.equal(login.data.session.user.email,'owner@example.com');
    const identity=await adapter.auth.getUser(login.data.session.access_token);
    assert.ifError(identity.error);
    assert.equal(identity.data.user.email,'owner@example.com');
    const {data:permissions,error}=await adapter.authClient.schema('silver').rpc('manage',{p_type:'self'});
    assert.ifError(error);
    assert.equal(permissions[0].id,'lo3rwang');
    const {data:articles,error:readError}=await adapter.publicClient.schema('silver').from('lo3rwang_galaxy').select('uid');
    assert.ifError(readError);
    assert.equal(articles[0].uid,'aB12cD34');
    const privateRequest=calls.find(c=>c.url.includes('/rpc/manage'));
    assert.equal(privateRequest.headers.get('authorization'),'Bearer '+jwt);
    assert.equal(calls.every(c=>c.url.startsWith(auth)||c.url.startsWith(api)),true);
    assert.equal(adapter.realtimeClient,null);
  }finally{if(original===undefined)delete globalThis.window;else globalThis.window=original;}
});
test('Neon rejects non-Google linked account rather than granting management rights',async()=>{
  const {fetchImpl}=simulatedNetwork({google:false});
  const adapter=createNeonPrimaryAdapter({url:api,authUrl:auth,fetchImpl});
  const login=await adapter.auth.getSession();
  const identity=await adapter.auth.getUser(login.data.session.access_token);
  assert.match(identity.error.message,/Google OAuth identity is not verified/);
  await assert.rejects(createDatabaseClient(adapter).getAccountSession(),
    /verified identity provider is required/);
});
test('Neon lacks a session: no verified user may be granted',async()=>{
  const {fetchImpl}=simulatedNetwork({loggedIn:false});
  const adapter=createNeonPrimaryAdapter({url:api,authUrl:auth,fetchImpl});
  const login=await adapter.auth.getSession();
  assert.ifError(login.error);
  assert.equal(login.data.session,null);
  await assert.rejects(createDatabaseClient(adapter).getAccountSession(),
    /verified identity provider is required/);
});

test('LOC uses Clerk identity while the independent Neon adapter remains deferred',()=>{
  const source=readFileSync(new URL('../app/loc/providers/configured.mjs',import.meta.url),'utf8');
  assert.match(source,/return createClerkGatewayAdapter\(\)/);
  assert.doesNotMatch(source,/createNeonPrimaryAdapter|loc-auth-provider|createSupabaseAdapter/);
  // Neon adapter tests remain available for schema consolidation; production
  // Clerk account selection does not depend on those incomplete schemas.
  const emergency=readFileSync(new URL('../app/AppShell.jsx',import.meta.url),'utf8');
  assert.match(emergency,/setEmergencyDatabasePrimary\(target\)/);
});

test('Neon does not reuse a JWT from a previous OAuth session',async()=>{
  let sessionId='session-one',jwt='a1.b1.c1';
  const fetchImpl=async(input,init={})=>{
    const url=String(input);
    let payload;
    if(url===auth+'/get-session')payload={user:{id:'verified-user',email:'owner@example.com',emailVerified:true},session:{id:sessionId}};
    else if(url===auth+'/token')payload={token:jwt};
    else if(url===auth+'/list-accounts')payload=[{providerId:'google',accountId:'google-id'}];
    else if(url.startsWith(api))payload=[];
    else throw Error('Unexpected request '+url);
    return new Response(JSON.stringify(payload),{status:200,headers:{'content-type':'application/json'}});
  };
  const adapter=createNeonPrimaryAdapter({url:api,authUrl:auth,fetchImpl});
  const first=await adapter.auth.getSession();
  assert.equal(first.data.session.access_token,'a1.b1.c1');
  sessionId='session-two';jwt='a2.b2.c2';
  const second=await adapter.auth.getSession();
  assert.equal(second.data.session.access_token,'a2.b2.c2');
  const previous=await adapter.auth.getUser(first.data.session.access_token);
  assert.match(previous.error.message,/token mismatch/);
});

test('Neon restores initial OAuth session to the passive account UI',async()=>{
  const {fetchImpl}=simulatedNetwork();
  const adapter=createNeonPrimaryAdapter({url:api,authUrl:auth,fetchImpl});
  const events=[];
  let notify;
  const initial=new Promise(resolve=>{notify=resolve});
  const registration=adapter.auth.onAuthStateChange((event,session)=>{
    events.push({event,userId:session?.user?.id||''});
    if(event==='INITIAL_SESSION')notify();
  });
  await initial;
  assert.deepEqual(events.map(e=>e.event),['SIGNED_IN','INITIAL_SESSION']);
  assert.equal(events.at(-1).userId,'verified-neon-user');
  const second=await adapter.auth.getSession();
  assert.equal(second.data.session.user.id,'verified-neon-user');
  assert.equal(events.filter(x=>x.event==='SIGNED_IN').length,1);
  registration.data.subscription.unsubscribe();
  const {error}=await adapter.auth.signOut();
  assert.ifError(error);
  assert.equal(events.filter(x=>x.event==='SIGNED_OUT').length,0);
});

test('Neon login network error does not broadcast a false SIGNED_OUT event',async()=>{
  let fail=false;
  const {fetchImpl}=simulatedNetwork();
  const adapter=createNeonPrimaryAdapter({url:api,authUrl:auth,
    fetchImpl:(url,options)=>fail?Promise.reject(new TypeError('fetch failed')):fetchImpl(url,options)});
  const events=[];
  const reg=adapter.auth.onAuthStateChange((e)=>events.push(e));
  await adapter.auth.getSession();
  fail=true;
  const state=await adapter.auth.getSession();
  assert.match(state.error.message,/fetch failed/);
  assert.equal(events.includes('SIGNED_OUT'),false);
  reg.data.subscription.unsubscribe();
});

test('concurrent Neon authenticated reads share one token exchange per session',async()=>{
  const requests=[];
  const fetchImpl=async(input,init={})=>{
    const url=String(input);
    requests.push({url,signal:init.signal});
    let body;
    if(url===auth+'/get-session')body={user:{id:'signed-user',email:'owner@example.com',emailVerified:true},session:{id:'active-s'}};
    else if(url===auth+'/token')body={token:jwt};
    else if(url.startsWith(api))body=[{uid:'aB12cD34'}];
    else throw Error('Unexpected request '+url);
    return new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}});
  };
  const adapter=createNeonPrimaryAdapter({url:api,authUrl:auth,fetchImpl});
  const [a,b]=await Promise.all([
    adapter.authClient.schema('silver').from('lo3rwang_galaxy').select('uid'),
    adapter.authClient.schema('silver').from('lrunes_galaxy').select('uid')
  ]);
  assert.ifError(a.error);assert.ifError(b.error);
  assert.equal(requests.filter(x=>x.url===auth+'/token').length,1);
  assert.equal(requests.filter(x=>x.url.startsWith(api)).length,2);
  assert.ok(requests.every(x=>x.signal instanceof AbortSignal));
});
