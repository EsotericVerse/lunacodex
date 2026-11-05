import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createIndependentClerkIdentity,clerkReturnPath} from '../app/loc/auth/clerk-identity.mjs';

const siteOrigin='https://loc.example.org';
const authorityOrigin='https://control.example.org';
function fixture({id='user_test',status=200,subject=id,token='signed.jwt.token'}={}){
  const requests=[],navigations=[];
  const clerk={
    user:id?{id}:null,
    session:id?{getToken:async()=>token}:null,
    signOut:async()=>{clerk.user=null;clerk.session=null;},
    addListener:callback=>{clerk.listener=callback;return ()=>{clerk.listener=null;}}
  };
  const adapter=createIndependentClerkIdentity({
    siteOrigin,authorityOrigin,
    loadClerk:async()=>clerk,
    navigate:path=>navigations.push(path),
    fetchImpl:async(url,init)=>{
      requests.push({url,init});
      return {ok:status===200,status,json:async()=>status!==200?{error:'Clerk authorized party does not match LOC'}:({
        provider:'clerk',subject,session:'sess_verified',email:'owner@example.com'
      })};
    }
  });
  return {clerk,adapter,requests,navigations};
}
test('independent Identity uses only Clerk and a trusted LOC Authority identity check',async()=>{
  const {adapter,requests}=fixture();
  const identity=await adapter.verifiedIdentity();
  assert.equal(identity.subject,'user_test');
  assert.equal(identity.provider,'clerk');
  assert.equal(identity.email,'owner@example.com');
  assert.equal(Object.isFrozen(identity),true);
  assert.equal(requests.length,1);
  assert.equal(requests[0].url,authorityOrigin+'/v1/identity');
  assert.equal(requests[0].init.headers.authorization,'Bearer signed.jwt.token');
  assert.equal(requests[0].init.credentials,'omit');
});
test('unverified, malformed, or mismatching principal is denied',async()=>{
  await assert.rejects(fixture({status:403}).adapter.verifiedIdentity(),/rejected/);
  await assert.rejects(fixture({subject:'user_other'}).adapter.verifiedIdentity(),/mismatch/);
  const signedOut=fixture({id:''});
  assert.equal(await signedOut.adapter.verifiedIdentity(),null);
  assert.equal(signedOut.requests.length,0);
  await assert.rejects(signedOut.adapter.getAccessToken(),/login required/);
});
test('redirect cannot escape LOC origin or leak OAuth through database provider',async()=>{
  const {adapter,navigations}=fixture();
  await adapter.signIn('/local/settings/?section=home');
  assert.equal(navigations[0],'/login/index.html?return_to=%2Flocal%2Fsettings%2F%3Fsection%3Dhome');
  await adapter.signIn('//malicious.example');
  assert.equal(navigations[1],'/login/index.html?return_to=%2Flocal%2Fsettings%2F');
  assert.equal(clerkReturnPath('/admin?area=db',siteOrigin),'/admin?area=db');
  assert.equal(clerkReturnPath('https://loc.example.org/local/settings/?tab=db',siteOrigin),'/local/settings/?tab=db');
  assert.equal(clerkReturnPath('https://malicious.example/x',siteOrigin),'/local/settings/');
});
test('logout and listener are Clerk-only',async()=>{
  const {adapter,clerk}=fixture();
  const snapshots=[];
  const unsubscribe=await adapter.onChange(status=>snapshots.push(status));
  clerk.listener();
  await adapter.signOut();
  clerk.listener();
  unsubscribe();
  assert.deepEqual(snapshots,[true,false]);
});
test('same Clerk session reuses verified identity across JWT rotation without extra Authority calls',async()=>{
  let token='jwt.one',calls=0;
  const clerk={user:{id:'user_test'},session:{id:'sess_verified',getToken:async()=>token}};
  const adapter=createIndependentClerkIdentity({siteOrigin,authorityOrigin,loadClerk:async()=>clerk,
    fetchImpl:async()=>{calls++;return {ok:true,status:200,json:async()=>({provider:'clerk',subject:'user_test',session:'sess_verified',email:'owner@example.com'})};}});
  await adapter.verifiedIdentity();token='jwt.two';await adapter.verifiedIdentity();
  assert.equal(calls,1);
  clerk.session={id:'sess_replaced',getToken:async()=>token};
  await assert.rejects(adapter.verifiedIdentity(),/mismatch/);
  assert.equal(calls,2);
});

test('no database adapter or legacy OAuth is imported by independent identity',()=>{
  const source=readFileSync(new URL('../app/loc/auth/clerk-identity.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/supabase-js|neon-primary|get_my_scope_management|signInWithOAuth|auth\/v1/);
  assert.match(source,/\/v1\/identity/);
});

test('author edit displays the safe Authority rejection reason rather than only HTTP 401',async()=>{
  await assert.rejects(fixture({status:401}).adapter.verifiedIdentity(),
    /HTTP 401：Clerk authorized party does not match LOC/);
});

test('a dropped Authority network request recovers once without losing verified identity',async()=>{
  const {adapter}=fixture({id:'user_test'});
  let attempts=0;
  const identity=createIndependentClerkIdentity({
    siteOrigin,authorityOrigin,
    loadClerk:async()=>({user:{id:'user_test'},session:{getToken:async()=> 'signed.jwt.token'}}),
    fetchImpl:async()=>{
      attempts++;
      if(attempts===1)throw new TypeError('Failed to fetch');
      return {ok:true,status:200,json:async()=>({
        provider:'clerk',subject:'user_test',session:'sess_verified',email:'owner@example.com'
      })};
    }
  });
  const result=await identity.verifiedIdentity();
  assert.equal(result.subject,'user_test');
  assert.equal(attempts,2);
  assert.equal((await adapter.verifiedIdentity()).provider,'clerk');
});
test('permission denial never retries and persistent network failure is bounded',async()=>{
  let requests=0;
  const loadClerk=async()=>({
    user:{id:'user_test'},session:{getToken:async()=> 'signed.jwt.token'}
  });
  const noPermission=createIndependentClerkIdentity({
    siteOrigin,authorityOrigin,loadClerk,
    fetchImpl:async()=>{requests++;return {ok:false,status:403,json:async()=>({error:'Access denied'})};}
  });
  await assert.rejects(noPermission.verifiedIdentity(),/HTTP 403/);
  assert.equal(requests,1);
  requests=0;
  const disconnected=createIndependentClerkIdentity({
    siteOrigin,authorityOrigin,loadClerk,
    fetchImpl:async()=>{requests++;throw new TypeError('Failed to fetch');}
  });
  await assert.rejects(disconnected.verifiedIdentity(),/身分核驗連線失敗/);
  assert.equal(requests,2);
});
test('Settings exposes account recheck and reconnect only on actual network failures',()=>{
  const settings=readFileSync(new URL('../app/loc/GlobalSettings.jsx',import.meta.url),'utf8');
  const account=readFileSync(new URL('../app/loc/use-account.js',import.meta.url),'utf8');
  assert.match(settings,/重新確認登入狀態/);
  assert.match(settings,/verifiedGoogleAccount\.refresh\(\)/);
  assert.match(account,/window\.addEventListener\('online',recheck\)/);
  assert.match(account,/document\.addEventListener\('visibilitychange',onVisible\)/);
  assert.ok(account.includes('Failed to fetch|連線失敗|NetworkError|Load failed'));
});

test('one signed-in Clerk JWT reuses only the verified identity for sequential calls',async()=>{
  const {adapter,requests,clerk}=fixture();
  const one=await adapter.verifiedIdentity();
  const two=await adapter.verifiedIdentity();
  assert.strictEqual(one,two);
  assert.equal(requests.length,1,'two sequential UI reads must not hit Authority twice');
  await adapter.signOut();
  assert.equal(await adapter.verifiedIdentity(),null);
  assert.equal(requests.length,1,'sign-out must not reuse cached identity');
});
test('Clerk token rotation and account change always trigger fresh verification',async()=>{
  let token='jwt.one',id='user_one',requests=0;
  const clerk={user:{id},session:{getToken:async()=>token}};
  const adapter=createIndependentClerkIdentity({
    siteOrigin,authorityOrigin,loadClerk:async()=>clerk,
    fetchImpl:async()=>{requests++;return {ok:true,status:200,json:async()=>({
      provider:'clerk',subject:clerk.user.id,session:'sess_verified',email:'owner@example.com'
    })};}
  });
  await adapter.verifiedIdentity();await adapter.verifiedIdentity();
  assert.equal(requests,1);
  token='jwt.two';await adapter.verifiedIdentity();assert.equal(requests,2);
  clerk.user={id:'user_two'};await adapter.verifiedIdentity();
  assert.equal(requests,3,'same token cannot reuse a different user identity');
});
