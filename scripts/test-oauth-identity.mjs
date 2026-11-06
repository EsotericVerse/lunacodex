import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {parseVerifiedGoogleOAuthUser} from '../app/loc/oauth-identity.mjs';
import {createDatabaseClient} from '../app/loc/db-contract.mjs';
import {setAuthorization,readAuthorization,clearAuthorization,canAuthorizeScope,canAuthorizeGlobal,canAuthorizeGroup,createScopeAuthorizer,assertAuthorizationForTable} from '../app/loc/authorization-runtime.mjs';

const validUser=(provider='google',oauthEmail='owner@example.com')=>({
  id:'supabase-user-1',email:'owner@example.com',
  identities:[{provider,user_id:'supabase-user-1',provider_id:'google-uid-77',
    identity_data:{email:oauthEmail,email_verified:true}}]
});

test('Google identity email is parsed from verified OAuth identity',()=>{
  const identity=parseVerifiedGoogleOAuthUser(validUser());
  assert.deepEqual({...identity},{provider:'google',email:'owner@example.com',providerId:'google-uid-77',userId:'supabase-user-1'});
  assert.equal(Object.isFrozen(identity),true);
});

test('user.email alone is not Google OAuth proof',()=>{
  assert.throws(()=>parseVerifiedGoogleOAuthUser({id:'supabase-user-1',email:'owner@example.com',identities:[]}),/Google OAuth/);
});
test('other OAuth/email identities are rejected',()=>{
  assert.throws(()=>parseVerifiedGoogleOAuthUser(validUser('email')),/Google OAuth/);
});
test('mismatched Google identity email is rejected',()=>{
  assert.throws(()=>parseVerifiedGoogleOAuthUser(validUser('google','other@example.com')),/不一致/);
});
test('unverified OAuth identity email is rejected',()=>{
  const u=validUser();u.identities[0].identity_data.email_verified=false;
  assert.throws(()=>parseVerifiedGoogleOAuthUser(u),/尚未驗證/);
});
test('missing Google email_verified claim is rejected',()=>{
  const u=validUser();delete u.identities[0].identity_data.email_verified;
  assert.throws(()=>parseVerifiedGoogleOAuthUser(u),/尚未驗證/);
});
test('Google identity belonging to different Supabase user is rejected',()=>{
  const u=validUser();u.identities[0].user_id='other-user';
  assert.throws(()=>parseVerifiedGoogleOAuthUser(u),/Google OAuth/);
});
test('Google identity without optional provider ID remains verified',()=>{
  const u=validUser();delete u.identities[0].provider_id;
  assert.equal(parseVerifiedGoogleOAuthUser(u).email,'owner@example.com');
});

// A database SDK is no longer a LOC identity provider, even if it returns
// its own signed-in Google user. Only an Authority-verified adapter is accepted.
test('LOC account contract refuses the deprecated Supabase Auth fallback',async()=>{
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
  assert.ok(settings.includes('Google OAuth（已驗證）：{account.email}'));
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
  const user={id:'supabase-user-1',email:'owner@example.com'};
  try{
    setAuthorization(user,[
      {id:'lo3rwang',email:'owner@example.com',role:'scope',galaxy:'private-metadata'},
      {id:'other',email:'not-owner@example.com',role:'admin'}
    ]);
    assert.deepEqual(readAuthorization().entries,[{scopeid:'lo3rwang',email:'owner@example.com',role:'scope'}]);
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
