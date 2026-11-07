import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {shouldInvalidateManagementForAuthEvent} from '../app/loc/auth/account-event-guard.mjs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const session={nextUserId:'user_ABC123',nextEmail:'owner@example.org'};

test('initial LOC Auth hydration never cancels pending management query',()=>{
  const initial=shouldInvalidateManagementForAuthEvent({
    event:'INITIAL_SESSION',previousUserId:'',previousEmail:'',
    ...session,hasAuthorization:false
  });
  assert.equal(initial,false);
  assert.equal(shouldInvalidateManagementForAuthEvent({
    event:'SIGNED_IN',previousUserId:'',previousEmail:'',
    ...session,hasAuthorization:false
  }),false);
});

test('repeated auth events for the same verified identity preserve editor role',()=>{
  for(const event of ['INITIAL_SESSION','SIGNED_IN','TOKEN_REFRESHED']){
    assert.equal(shouldInvalidateManagementForAuthEvent({
      event,previousUserId:session.nextUserId,previousEmail:session.nextEmail,
      ...session,hasAuthorization:true
    }),false);
  }
});

test('real logout and account replacement revoke management grants',()=>{
  assert.equal(shouldInvalidateManagementForAuthEvent({
    event:'SIGNED_OUT',previousUserId:session.nextUserId,previousEmail:session.nextEmail,
    nextUserId:'',nextEmail:'',hasAuthorization:true
  }),true);
  assert.equal(shouldInvalidateManagementForAuthEvent({
    event:'SIGNED_IN',previousUserId:session.nextUserId,previousEmail:session.nextEmail,
    nextUserId:'user_OTHER123',nextEmail:'other@example.org',hasAuthorization:true
  }),true);
  assert.equal(shouldInvalidateManagementForAuthEvent({
    event:'INITIAL_SESSION',previousUserId:session.nextUserId,previousEmail:session.nextEmail,
    nextUserId:'',nextEmail:'',hasAuthorization:true
  }),true);
});

test('a first identity event with prior permission snapshot still revokes a different user',()=>{
  assert.equal(shouldInvalidateManagementForAuthEvent({
    event:'INITIAL_SESSION',previousUserId:'',previousEmail:'',
    ...session,hasAuthorization:true
  }),true);
});

test('management page does not run concurrent HomeEditModeRestore RPC',()=>{
  const shell=read('app/AppShell.jsx');
  const access=read('app/loc/ManagementAccess.jsx');
  assert.match(shell,/!isManagementHref\(pathname\)/);
  assert.match(access,/const account=useAccount\(\{enabled:false\}\)/);
  assert.match(access,/granted\(verification\.authorizer,scopeId,level\)/);
});

test('initial LOC Auth event does not invalidate active management query in useAccount',()=>{
  const account=read('app/loc/use-account.js');
  const start=account.indexOf('const listener=dbAuthEvents.onAuthStateChange(');
  const end=account.indexOf('return ()=>listener.data.subscription.unsubscribe()',start);
  const listener=account.slice(start,end);
  assert.match(listener,/shouldInvalidateManagementForAuthEvent\(/);
  assert.match(listener,/if\(invalidate\)\{\s*authRevision\+=1/);
  assert.match(listener,/if\(invalidate\)\{[\s\S]*mutate\(MANAGEMENT_KEY,undefined,\{revalidate:false\}\)/);
  assert.doesNotMatch(listener,/if\(identityChanged\|\|event==='SIGNED_OUT'\)/);
});

test('initial unauthenticated LOC Auth event cannot erase cross-page edit marker before verification',()=>{
  const dock=read('app/modular/edit-dock.jsx');
  assert.match(dock,/if\(!invalidated\|\|!activeScope\.current\)return/);
  assert.match(dock,/if\(userId\)lastIdentity=identity/);
  assert.match(dock,/if\(activeScope\.current==='local'&&Capacitor\.isNativePlatform\(\)\)return/);
  assert.match(dock,/const invalidated=event==='SIGNED_OUT'\|\|identityChanged/);
});
