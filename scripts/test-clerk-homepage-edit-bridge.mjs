import test from 'node:test';
import assert from 'node:assert/strict';
import {clerkSqlClaims} from '../app/loc/auth/clerk-sql-claims.mjs';
import {RPC_ALLOWLIST,buildAllowlistedRpcQuery} from '../app/loc/providers/kysely-runtime.mjs';
import {readFileSync} from 'node:fs';

const issuer='https://example.clerk.accounts.dev';
const origin='https://loc.example.org';
const principal={iss:issuer,azp:origin,sub:'user_ABC123',sid:'sess_ABC123',
  email:'OWNER@example.org',email_verified:true};
test('verified signed claims map to existing SQL role and email',()=>{
  const result=clerkSqlClaims(principal,{issuer,origin});
  assert.deepEqual(result,{role:'authenticated',sub:'user_ABC123',
    email:'owner@example.org',iss:issuer,sid:'sess_ABC123',provider:'clerk'});
  assert.equal(Object.isFrozen(result),true);
});
test('unsigned, other-origin and unverified claims are never promoted',()=>{
  for(const payload of [{...principal,email_verified:false},
    {...principal,azp:'https://attacker.example'},
    {...principal,sub:'bad'},{...principal,iss:'https://fake.example'},
    {...principal,email:'owner@example.org invalid'},
    {...principal,email:''},{...principal,sid:'not-a-session'}]){
    assert.throws(()=>clerkSqlClaims(payload,{issuer,origin}));
  }
});
test('home editor can read existing permission RPC through Kysely as a rowset',()=>{
  assert.deepEqual(RPC_ALLOWLIST['silver.get_my_scope_management'],[]);
  const built=buildAllowlistedRpcQuery({kind:'rpc',schema:'silver',
    name:'get_my_scope_management',args:{}});
  assert.equal(built.returnsRows,true);
});
test('management search refresh accepts exactly one Scope ID with required argument',()=>{
  assert.deepEqual(RPC_ALLOWLIST['silver.refresh_scope_search_summary'],['p_scope_id']);
  const built=buildAllowlistedRpcQuery({kind:'rpc',schema:'silver',
    name:'refresh_scope_search_summary',args:{p_scope_id:'lo3rwang'}});
  assert.equal(built.returnsRows,false);
  assert.ok(built.query,'A Kysely SQL expression must be generated');
  assert.throws(()=>buildAllowlistedRpcQuery({kind:'rpc',schema:'silver',
    name:'refresh_scope_search_summary',args:{}}),/Missing required RPC argument/);
  assert.throws(()=>buildAllowlistedRpcQuery({kind:'rpc',schema:'silver',
    name:'refresh_scope_search_summary',args:{p_scope_id:'lo3rwang',p_bypass:true}}),
    /Unexpected RPC argument/);
  assert.throws(()=>buildAllowlistedRpcQuery({kind:'rpc',schema:'silver',
    name:'refresh_search_summary_without_authorization',args:{p_scope_id:'lo3rwang'}}),
    /RPC is not enabled/);
});
test('Search public summary uses snapshot; refresh remains a manager-only action',()=>{
  const source=readFileSync(new URL('../app/loc/SearchSummary.jsx',import.meta.url),'utf8');
  const refresh=readFileSync(new URL('../app/loc/scope-search-summary.mjs',import.meta.url),'utf8');
  assert.match(source,/managementMode\?<button/);
  assert.match(source,/for\(const id of ids\)await refreshScopeSearchSummary\(id\)/);
  assert.match(refresh,/dbAuthClient\.schema\('silver'\)/);
  assert.match(refresh,/\.rpc\('refresh_scope_search_summary',\{p_scope_id:ids\[0\]\}\)/);
  assert.match(refresh,/silver\.scope_search_summary/);
});
test('legacy SQL Auth continues to validate Supabase user independently',()=>{
  const code=readFileSync(new URL('../supabase/functions/loc-kysely/index.ts',import.meta.url),'utf8');
  assert.match(code,/authClient\.auth\.getUser\(token\)/);
  assert.match(code,/verifyClerkForSql\(token\)/);
  assert.match(code,/jwtVerify\(token,clerkKeys/);
  assert.match(code,/clerkSqlClaims\(payload,/);
});
test('independent Clerk editor never writes to Neon',()=>{
  const source=readFileSync(new URL('../app/loc/providers/clerk-gateway.mjs',import.meta.url),'utf8');
  assert.match(source,/getAccessToken,fetch:fetchImpl/);
  assert.match(source,/loc-kysely-clerk/);
  assert.doesNotMatch(source,/createNeonPrimaryAdapter|createBackupPublicAdapter/);
});

test('production LOC routes every account login via Clerk, with no per-device toggle',()=>{
  const configured=readFileSync(new URL('../app/loc/providers/configured.mjs',import.meta.url),'utf8');
  const client=readFileSync(new URL('../app/loc/providers/clerk-gateway.mjs',import.meta.url),'utf8');
  assert.match(configured,/return createClerkGatewayAdapter\(\)/);
  assert.doesNotMatch(configured,/loc-auth-provider|NEXT_PUBLIC_LOC_IDENTITY_PROVIDER|createNeonPrimaryAdapter/);
  assert.doesNotMatch(client,/createSupabaseAdapter|autoRefreshToken:true|persistSession:true/);
  assert.match(client,/loc-kysely-clerk/);
});

test('verified Clerk subject can be mapped to a trusted root email by server, not browser',()=>{
  const missing={...principal,email:undefined,email_verified:undefined,azp:undefined};
  assert.throws(()=>clerkSqlClaims(missing,{issuer,origin}),/trusted root mapping/);
  const mapped=clerkSqlClaims(missing,{issuer,origin,trustedEmail:'OWNER@example.org'});
  assert.equal(mapped.email,'owner@example.org');
  assert.equal(mapped.sub,'user_ABC123');
  assert.equal(mapped.role,'authenticated');
  assert.throws(()=>clerkSqlClaims(missing,{issuer,origin,trustedEmail:'invalid'}));
  assert.throws(()=>clerkSqlClaims({...missing,azp:'https://evil.example'},
    {issuer,origin,trustedEmail:'owner@example.org'}));
});
test('managed MCP SQL sync is restricted to verified OAuth Scope writes',()=>{
  const edge=readFileSync(new URL('../supabase/functions/loc-kysely/index.ts',import.meta.url),'utf8');
  const worker=readFileSync(new URL('../workers/loc-authority/index.mjs',import.meta.url),'utf8');
  assert.match(edge,/audience:mcpResource,algorithms:\["RS256"\]/);
  assert.match(edge,/verifyMcpForSql\(token,String\(body\.scopeid/);
  assert.match(edge,/MCP tokens cannot execute general database requests/);
  assert.match(edge,/kind:"rpc",schema:"silver",name:"management_write"/);
  assert.match(edge,/\{column:"site_id",operator:"eq",value:row\.site_id\}/);
  assert.match(worker,/if\(!isRoot\|\|!await allowed\(scopeid,'write'\)\)/);
  assert.match(worker,/managedMcpInsert\(scopeid,row,Boolean\(status\.uid\),oauthToken\)/);
});

test('Clerk SQL gateway obtains root email from Authority, never unsigned request email',()=>{
  const edge=readFileSync(new URL('../supabase/functions/loc-kysely/index.ts',import.meta.url),'utf8');
  assert.match(edge,/LOC Authority could not verify Clerk root identity/);
  assert.match(edge,/identity.subject!==payload.sub/);
  assert.match(edge,/identity.session!==payload.sid/);
  assert.match(edge,/trustedEmail/);
});
