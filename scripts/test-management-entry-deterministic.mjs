import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyManagementEntry} from '../app/loc/auth/management-entry-verification.mjs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('a valid management check returns one verified user and authorizer',async()=>{
  const user={id:'user_ABC123',email:'owner@example.org'};
  let calls=0;
  const result=await verifyManagementEntry(async()=>{
    calls++;
    return {user,authorizer:{canManageScopeSync:()=>true}};
  });
  assert.equal(calls,1);
  assert.equal(result.user,user);
  assert.equal(result.authorizer.canManageScopeSync('lo3rwang'),true);
});

test('not signed in settles as null instead of a permanent loading state',async()=>{
  assert.equal(await verifyManagementEntry(async()=>null),null);
});

test('permission failure rejects and is surfaced by the management gate',async()=>{
  await assert.rejects(()=>verifyManagementEntry(async()=>{
    throw Error('Permission RPC forbidden');
  }),/Permission RPC forbidden/);
});

test('a stalled Clerk or SQL call reaches an explicit timeout',async()=>{
  await assert.rejects(()=>verifyManagementEntry(()=>new Promise(()=>{}),
    {timeoutMs:5}),/管理權限核驗逾時/);
});

test('management entry verifies once and sends failed access to the scenic login',()=>{
  const gate=read('app/loc/ManagementAccess.jsx');
  assert.match(gate,/useAccount\\(\\{enabled:false\\}\\)/);
  assert.match(gate,/verifyManagementEntry\\(fromLogin\\?account\\.refresh:check\\)/);
  assert.match(gate,/account\\.refresh\\(\\)/);
  assert.match(gate,/setVerification\\(\\{loading:false,user:result\\?\\.user/);
  assert.match(gate,/window\\.location\\.replace\\('\/login\/index\\.html\\?return_to='/);
  assert.doesNotMatch(gate,/管理權限核驗失敗，暫時無法編輯|重新確認管理權限/);
  assert.doesNotMatch(gate,/const ready=!account\\.loading/);
});

test('UI gate only enters the editor after checked Scope authorization',()=>{
  const gate=read('app/loc/ManagementAccess.jsx');
  assert.match(gate,/granted\(verification\.authorizer,scopeId,level\)/);
  assert.match(gate,/if\(!allowed\|\|entered\)return/);
  assert.match(gate,/dock\?\.begin\(scopeId\)/);
  assert.match(gate,/dbAuthEvents\.onAuthStateChange/);
  assert.match(gate,/event==='SIGNED_OUT'/);
});

test('passive consumers do not refetch an already verified management grant',()=>{
  const account=read('app/loc/use-account.js');
  assert.match(account,/function loadManagementAccount\(mutate,\{force=false\}=\{\}\)/);
  assert.match(account,/if\(!force\)\{\s*const verified=readVerifiedManagementEntry\(\)/);
  assert.match(account,/return Promise\.resolve\(\{[\s\S]*authorizer:verified\.authorizer/);
  assert.match(account,/sessionOnly\?queryFn:\(\)=>loadManagementAccount\(mutate,\{force:true\}\)/);
  const home=read('app/loc/ScopeHomeEditEntry.jsx');
  assert.match(home,/const result=await account\.refresh\(\)/);
});
