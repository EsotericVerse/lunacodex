import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {issueDelegation,verifyDelegationBoundary,canManageDelegation}
  from '../app/loc/auth/delegation-contract.mjs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('LOC Authority verifies only signed native login identities',()=>{
  const worker=read('workers/loc-authority/index.mjs');
  assert.match(worker,/const principal=await verifyNativeOAuth\(request,env,WEB_AUDIENCE\)/);
  assert.doesNotMatch(worker,/verifyIdentityToken\(/);
  assert.match(worker,/LOC_RECOVERY_ROOT_LOC_SUBJECTS/);
  assert.match(worker,/const sub=principal\.subject/);
});

test('LOC credentials remain encrypted in the Authority state',()=>{
  const worker=read('workers/loc-authority/index.mjs');
  assert.match(worker,/encryptProfile\(profile,this\.env\.LOC_CONTROL_ENCRYPTION_KEY\)/);
  assert.match(worker,/decryptProfile\(/);
  assert.match(worker,/databaseTargetsForUser\(subject,isRoot=false\)/);
  assert.match(worker,/id:'loc-main'/);
});

test('a signed Scope grant cannot become a global or another Scope grant',()=>{
  const now=Math.floor(Date.now()/1000);
  const claims=issueDelegation({sub:'loc_'+('A'.repeat(40)),
    email:'reader@example.org',grants:['lrunes:manage'],audience:'sql',
    sid:'verified-test',now,seconds:300});
  const result=verifyDelegationBoundary(claims,{kind:'query'});
  assert.equal(canManageDelegation(result.claims,'scope','lrunes'),true);
  assert.equal(canManageDelegation(result.claims,'scope','lo3rwang'),false);
  assert.equal(canManageDelegation(result.claims,'global'),false);
});
