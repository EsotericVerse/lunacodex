import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {canManageDelegation,issueDelegation,verifyDelegationBoundary}
  from '../app/loc/auth/delegation-contract.mjs';
const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('SQL Edge verifies locally signed LOC delegation, not provider identity',()=>{
  const edge=source('app/loc/gateway/sql-handler.ts');
  assert.match(edge,/verifyLocDelegation\(match\[1\],body\)/);
  assert.match(edge,/verifyDelegationBoundary\(payload,body,/);
  assert.match(edge,/delegationAudience\(body\)/);
  assert.doesNotMatch(edge,/verifyClerkForSql|verifyMcpForSql|sessionIdentityCache/);
});
test('Kysely and Edge share one LOC delegation policy',()=>{
  const edge=source('app/loc/gateway/sql-handler.ts');
  const auth=source('app/loc/providers/loc-authorization.mjs');
  const issuer=source('scripts/loc-delegation-mint-token.mjs');
  assert.match(edge,/from ".{1,80}\/delegation-contract\.mjs"/);
  assert.match(auth,/canManageDelegation\(state\.claims,/);
  assert.match(issuer,/issueDelegation\(/);
  assert.doesNotMatch(auth,/grants\.includes\('global:manage'\)/);
});
test('signed grants are portable and scope-limited independently of database RLS',()=>{
  const now=Math.floor(Date.now()/1000);
  const token=issueDelegation({sub:'user_test',email:'test@example.org',
    grants:['lrunes:manage'],audience:'sql',sid:'test1',now,seconds:600});
  const {claims}=verifyDelegationBoundary(token,{kind:'query'});
  assert.equal(canManageDelegation(claims,'scope','lrunes'),true);
  assert.equal(canManageDelegation(claims,'scope','lo3rwang'),false);
  assert.equal(canManageDelegation(claims,'global'),false);
});
test('existing Clerk browser adapter remains optional and isolated from the SQL engine',()=>{
  const gateway=source('app/loc/providers/clerk-gateway.mjs');
  assert.match(gateway,/createClerkAccountAdapter/);
  const edge=source('app/loc/gateway/sql-handler.ts');
  assert.doesNotMatch(edge,/createClerkAccountAdapter/);
});
