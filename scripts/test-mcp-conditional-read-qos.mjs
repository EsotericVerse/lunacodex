import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {issueDelegation,verifyDelegationBoundary} from '../app/loc/auth/delegation-contract.mjs';

test('known UID MCP read keeps Scope read and manager-only GitHub source boundaries',()=>{
  const now=2000000000;
  const request=(site)=>({kind:'mcp-read',scopeid:'lo3rwang',site});
  const token=(grants)=>issueDelegation({sub:'user123',sid:'session123',
    email:'test@example.org',grants,audience:'mcp',now,seconds:300});
  assert.equal(verifyDelegationBoundary(token(['lo3rwang:read']),
    request('mcp'),{now:now+1}).verifiedMcp,true);
  assert.throws(()=>verifyDelegationBoundary(token(['lo3rwang:read']),
    request('github'),{now:now+1}),/does not cover/);
  assert.equal(verifyDelegationBoundary(token(['lo3rwang:manage']),
    request('github'),{now:now+1}).verifiedMcp,true);
  assert.throws(()=>verifyDelegationBoundary(token(['lrunes:manage']),
    request('github'),{now:now+1}),/does not cover/);
  assert.throws(()=>verifyDelegationBoundary(token(['lo3rwang:manage']),
    {...request('github'),kind:'mcp-search'},{now:now+1}),/does not cover|Invalid delegated/);
});

test('MCP keeps the full QoS, warning, cooldown and conditional known-UID read',()=>{
  const worker=readFileSync(new URL('../workers/loc-authority/index.mjs',import.meta.url),'utf8');
  for(const expr of [
    'async mcpQuotaAcquire(kind,subject)',
    "const searchWindowMs=300_000",
    "const maximum=16",
    "rejected:'search-warning'",
    "rejected:'search-cooldown'",
    'Math.min(3_600_000,180_000*2**(strikes-1))',
    'mcpQuotaRelease(ticket.lease',
    "requestedSite==='github'?'manage':'read'",
    "result.site==='github'&&!await allowed(scopeid,'manage')",
    "const onlySite=siteFilter===true?'mcp':(siteFilter||'mcp')"
  ])assert.ok(worker.includes(expr),expr);
  assert.match(worker,/mcpPrLookup\(input\?\.query\)/);
  assert.match(worker,/update-pr.*use GitHub/i);
  assert.doesNotMatch(worker,/async mcpUpdatePr\s*\(/);
});
