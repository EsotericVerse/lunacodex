import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {issueDelegation,verifyDelegationBoundary,delegationAudience,canManageDelegation}
  from '../app/loc/auth/delegation-contract.mjs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('native delegations are scoped to one operation and database alias',()=>{
 const now=Math.floor(Date.now()/1000);
 const claims=issueDelegation({sub:'loc_test',grants:['lo3rwang:read'],
   audience:'mcp',sid:'session',now,seconds:90,targetId:'loc_main'});
 assert.equal(claims.aud,delegationAudience({kind:'mcp-read'}));
 const verified=verifyDelegationBoundary(claims,{kind:'mcp-read',scopeid:'lo3rwang'},{now});
 assert.equal(verified.claims.db_target,'loc_main');
 assert.equal(canManageDelegation(verified.claims,'global'),false);
 assert.throws(()=>verifyDelegationBoundary(claims,{kind:'mcp-append',scopeid:'lo3rwang'},{now}));
 assert.throws(()=>verifyDelegationBoundary(claims,{kind:'query'},{now}));
});

test('native app validates signed claims; generic SQL relay is absent',()=>{
 const native=read('app/loc/mcp/native-operations.mjs');
 assert.ok(native.includes('verifyDelegationBoundary'));
 assert.ok(native.includes('signedClaims'));
 assert.ok(native.includes('executePortableMcp'));
 assert.ok(!native.includes('LOC_SQL_GATEWAY_URL'));
 assert.equal(existsSync(new URL('../app/loc/gateway/sql-handler.ts',import.meta.url)),false);
});
