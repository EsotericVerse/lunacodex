import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {createLocAccountAdapter} from '../app/loc/auth/loc-browser.mjs';
import {createDatabaseClient} from '../app/loc/db-contract.mjs';
import {setAuthorization,readAuthorization,clearAuthorization,canAuthorizeScope,canAuthorizeGlobal,canAuthorizeGroup,createScopeAuthorizer,assertAuthorizationForTable}
  from '../app/loc/authorization-runtime.mjs';

const user={id:'loc_'+('A'.repeat(40)),email:'owner@example.com'};
const future=()=>Math.floor(Date.now()/1000)+300;
function nativeSession(overrides={}){
  return {user,provider:'loc',session:{user,access_token:'signed.loc.token',
    expires_at:future()},...overrides};
}
test('LOC browser identity accepts only native signed session metadata',async()=>{
  const adapter=createLocAccountAdapter({
    fetchImpl:async()=>Response.json(nativeSession())
  });
  assert.equal(await adapter.getAccessToken(),'signed.loc.token');
  assert.equal((await adapter.auth.getSession()).data.session.user.id,user.id);
});
test('LOC browser rejects mismatched identities and expired sessions',async()=>{
  for(const session of [
    nativeSession({session:{user:{id:'loc_'+('B'.repeat(40))},
      access_token:'signed.loc.token',expires_at:future()}}),
    nativeSession({session:{user,access_token:'signed.loc.token',expires_at:1}}),
    nativeSession({user:{id:'untrusted',email:'owner@example.com'}})
  ]){
    const adapter=createLocAccountAdapter({fetchImpl:async()=>Response.json(session)});
    await assert.rejects(adapter.getAccessToken(),/LOC Auth returned invalid/);
  }
});
// A database SDK is no longer a LOC identity provider, even if it returns
// its own signed-in Google user. Only an Authority-verified adapter is accepted.
test('LOC account contract refuses the deprecated legacy database Auth fallback',async()=>{
  const auth={
    getSession:async()=>({data:{session:{user:{id:'legacy-user'},access_token:'legacy-jwt'}},error:null}),
    getUser:async()=>({data:{user:validUser()},error:null}),
    signInWithOAuth:async()=>({error:null}),
    signOut:async()=>({error:null})
  };
  const read=createDatabaseClient({
    publicClient:{schema:()=>({})},authClient:{schema:()=>({})},auth
  }).getAccountSession;
  await assert.rejects(read(),/verified identity provider is required/);
});

test('Settings home owns the sole OAuth login action and verifies session',()=>{
  const account=readFileSync(new URL('../app/loc/use-account.js',import.meta.url),'utf8');
  const settings=readFileSync(new URL('../app/loc/GlobalSettings.jsx',import.meta.url),'utf8');
  assert.ok(account.includes('VERIFIED_SESSION_KEY'));
  assert.ok(account.includes('sessionOnly?(enabled?VERIFIED_SESSION_KEY:SESSION_KEY)'));
  assert.ok(settings.includes("useAccount({enabled:section==='home',sessionOnly:true})"));
  assert.ok(settings.includes('LOC Auth（已驗證）：{account.email}'));
  assert.ok(!settings.includes('account.email||account.user.email'));
  assert.equal(settings.match(/onClick=\{login\}/g)?.length,1);
  assert.equal(settings.match(/onClick=\{logout\}/g)?.length,1);
  assert.ok(!settings.includes("activeSection==='account'"));
  const editEntry=readFileSync(new URL('../app/loc/ScopeHomeEditEntry.jsx',import.meta.url),'utf8');
  assert.ok(!editEntry.includes('section=account'));
  assert.ok(editEntry.includes('uiExtra.editBlocks.signInToEnterEditMode'));
  assert.ok(editEntry.includes("uiExtra.editBlocks.enterEditMode"));
  assert.ok(editEntry.includes("useUiSection('uiExtra.editBlocks')"));
  assert.ok(!editEntry.includes("onClick={enter}>{busy?'正在確認權限…':'進入編輯模式'}</button>"));
});

test('pure JS permissions use only scopeid/email/role and are cleared on logout',()=>{
  const user={id:'loc_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',email:'sopa2306@gmail.com'};
  try{
    setAuthorization(user,[
      {id:'lo3rwang',email:'sopa2306@gmail.com',role:'scope',galaxy:'private-metadata'},
      {id:'other',email:'not-sopa2306@gmail.com',role:'admin'}
    ]);
    assert.deepEqual(readAuthorization().entries,[{scopeid:'lo3rwang',email:'sopa2306@gmail.com',role:'scope'}]);
    assert.equal(canAuthorizeScope('lo3rwang'),true);
    assert.equal(canAuthorizeGlobal(),false);
    assert.equal(canAuthorizeScope('other'),false);
    assert.equal(createScopeAuthorizer({id:'other-user',email:user.email}),null);
    assert.doesNotThrow(()=>assertAuthorizationForTable('silver.lo3rwang_galaxy'));
    assert.throws(()=>assertAuthorizationForTable('silver.other_galaxy'),/沒有此 Scope/);
    assert.throws(()=>assertAuthorizationForTable('silver.loc'),/沒有此 Scope/);
    setAuthorization(user,[{id:'loc',email:user.email,role:'group'}]);
    assert.equal(canAuthorizeGroup('loc'),true);
    assert.equal(canAuthorizeGlobal(),false);
    assert.doesNotThrow(()=>assertAuthorizationForTable('silver.loc'));
    assert.throws(()=>assertAuthorizationForTable('api.manage'),/沒有全域管理權限/);
    assert.throws(()=>assertAuthorizationForTable('silver.'+'manage'),/舊管理路由已停用/);
    setAuthorization(user,[{id:'admin',email:user.email,role:'admin'}]);
    assert.equal(canAuthorizeGlobal(),true);
    assert.doesNotThrow(()=>assertAuthorizationForTable('api.manage'));
    assert.doesNotThrow(()=>assertAuthorizationForTable('silver.loc'));
  }finally{clearAuthorization();}
  assert.equal(readAuthorization(),null);
  assert.equal(canAuthorizeScope('lo3rwang'),false);
});

test('LOC Google uses configured Google provider rather than unrelated OIDC login',async()=>{
 const navigations=[];
 const adapter=createLocAccountAdapter({
  fetchImpl:async()=>Response.json({session:null,user:null}),
  navigate:value=>navigations.push(value)
 });
 const result=await adapter.auth.signInWithOAuth({provider:'google',
  options:{redirectTo:'/local/settings/'}});
 assert.equal(result.error,null);
 const url=new URL(navigations[0]);
 assert.equal(url.origin,'https://auth.lo3rwang.cc');
 assert.equal(url.pathname,'/oauth/login');
 assert.equal(url.searchParams.get('provider'),'google');
 assert.equal(url.searchParams.get('return_to'),'/local/settings/');
 const github=await adapter.auth.signInWithOAuth({provider:'github'});
 assert.equal(github.error,null);
 assert.equal(new URL(navigations[1]).searchParams.get('provider'),'github');
 assert.equal(navigations.length,2,'only the requested provider redirects');
});
test('LOC Auth reuses an existing session without asking Google/GitHub to authenticate again',async()=>{
 const navigations=[];
 let reads=0;
 const adapter=createLocAccountAdapter({
  fetchImpl:async()=>{reads++;return Response.json(nativeSession())},
  navigate:value=>navigations.push(value)
 });
 const signedIn=await adapter.auth.signInWithOAuth({provider:'google'});
 assert.equal(signedIn.error,null);
 assert.equal(signedIn.data.session.user.id,user.id);
 const other=await adapter.auth.signInWithOAuth({provider:'github'});
 assert.equal(other.error,null);
 assert.equal(other.data.session.user.id,user.id);
 assert.equal(navigations.length,0,'a verified LOC session must not start another OAuth login');
 assert.equal(reads,1,'reuse the existing session response');
});
