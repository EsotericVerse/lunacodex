import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {issueDelegation,verifyDelegationBoundary,delegationAudience,canManageDelegation} from '../app/loc/auth/delegation-contract.mjs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('native signed LOC delegation keeps identity and database login separate',()=>{
 const now=Math.floor(Date.now()/1000);
 const signed=issueDelegation({sub:'loc_test',email:'sopa2306@gmail.com',
  grants:['lo3rwang:manage'],audience:'sql',sid:'session1',
  now,seconds:300,targetId:'loc_main'});
 assert.equal(signed.aud,delegationAudience({kind:'query'}));
 const value=verifyDelegationBoundary(signed,{kind:'query'}, {now});
 assert.equal(value.claims.db_target,'loc_main');
 assert.equal(canManageDelegation(value.claims,'scope','lo3rwang'),true);
 assert.equal(canManageDelegation(value.claims,'global'),false);
});

test('native LOC Auth requires Scope permission and rejects cross-audience tokens',()=>{
 const now=Math.floor(Date.now()/1000);
 const signed=issueDelegation({sub:'loc_test',grants:['lo3rwang:read'],
  audience:'mcp',sid:'session2',now,seconds:300});
 assert.equal(verifyDelegationBoundary(signed,{kind:'mcp-read',scopeid:'lo3rwang'},{now}).verifiedMcp,true);
 assert.throws(()=>verifyDelegationBoundary(signed,{kind:'mcp-read',scopeid:'lrunes'},{now}));
 assert.throws(()=>verifyDelegationBoundary(signed,{kind:'query'},{now}));
});

test('application authentication is native; no vendor SDK transport',()=>{
 const configured=read('app/loc/providers/configured.mjs');
 const native=read('workers/loc-authority/native-oauth.mjs');
 assert.match(configured,/createLocAccountAdapter/);
 assert.match(native,/PKCE|code_challenge_method/);
 assert.doesNotMatch(configured,/createLocGatewayAdapter|createKyselyEdgeClient/);
});
