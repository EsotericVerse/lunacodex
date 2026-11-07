import test from 'node:test';
import assert from 'node:assert/strict';
import {clerkSqlClaims} from '../app/loc/auth/clerk-sql-claims.mjs';
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
test('Clerk management actions are explicitly named and validated',()=>{
  const executor=readFileSync(new URL('../app/loc/providers/kysely-management.mjs',import.meta.url),'utf8');
  const account=readFileSync(new URL('../app/loc/use-account.js',import.meta.url),'utf8');
  assert.match(account,/\.managedAction\('manage',\{p_type:'self'\}\)/);
  assert.match(executor,/manage:\['p_type','p_id'\]/);
  assert.match(executor,/Object\.keys\(args\)\.some\(key=>!keys\.includes\(key\)\)/);
  assert.match(executor,/select \* from silver\.manage/);
});
test('public Search and statistics use Kysely analytics, never SQL RPC',()=>{
  const client=readFileSync(new URL('../app/loc/scope-search-summary.mjs',import.meta.url),'utf8');
  const analytics=readFileSync(new URL('../app/loc/providers/kysely-analytics.mjs',import.meta.url),'utf8');
  const manager=readFileSync(new URL('../app/loc/providers/kysely-management.mjs',import.meta.url),'utf8');
  assert.match(client,/\.analytics\(/);
  assert.match(client,/\.managedAction\('refresh_scope_search_summary'/);
  assert.match(analytics,/executeKyselyAnalytics/);
  assert.match(analytics,/mode==='search_summary'/);
  assert.match(manager,/refresh_scope_search_summary:\['p_scope_id'\]/);
});
test('Search summary only reads stored snapshot; refresh is handled by import management',()=>{
  const source=readFileSync(new URL('../app/loc/SearchSummary.jsx',import.meta.url),'utf8');
  const refresh=readFileSync(new URL('../app/loc/scope-search-summary.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/refreshScopeSearchSummary|managementMode\?<button|onClick=\{refresh\}/);
  const importer=readFileSync(new URL('../app/loc/ManagementImportPanel.jsx',import.meta.url),'utf8');
  assert.match(importer,/async function refreshImportedSearchSummary\(\)/);
  assert.match(importer,/const result=await refreshScopeSearchSummary\(scopeId\)/);
  assert.equal(importer.split('if(!nativeLocal)await refreshImportedSearchSummary();').length-1,2,
    'refresh after both normal and no-change completed imports');
  assert.match(importer,/onClick=\{refreshImportedSearchSummary\}/);
  assert.ok(importer.indexOf('await syncImportedMedia(')<importer.indexOf('if(!nativeLocal)await refreshImportedSearchSummary()'));
  assert.match(importer,/catch\(error\)\{\s*setSummaryError\(true\)/);
  assert.match(refresh,/dbAuthClient\.schema\('silver'\)/);
  assert.match(refresh,/\.managedAction\('refresh_scope_search_summary',\{p_scope_id:ids\[0\]\}\)/);
  assert.doesNotMatch(refresh,/silver\.scope_search_summary/);
  assert.match(refresh,/dbPublicClient\.schema\('silver'\)\.analytics/);
  assert.match(refresh,/p_view:'search_summary'/);
  assert.match(refresh,/data\?\.rows/);
});
test('SQL Edge verifies LOC delegation rather than provider-specific session RPC',()=>{
  const code=readFileSync(new URL('../supabase/functions/loc-kysely/index.ts',import.meta.url),'utf8');
  assert.match(code,/verifyLocDelegation\(match\[1\],body\)/);
  assert.match(code,/verifyDelegationBoundary\(payload,body,/);
  assert.doesNotMatch(code,/verifyClerkForSql|clerkSqlClaims|authClient\.auth\.getUser\(token\)/);
});
test('Clerk browser adapter exchanges OAuth into LOC delegation before Edge',()=>{
  const legacy=readFileSync(new URL('../app/loc/providers/clerk-gateway.mjs',import.meta.url),'utf8');
  const core=readFileSync(new URL('../app/loc/providers/loc-gateway.mjs',import.meta.url),'utf8');
  assert.match(legacy,/createLocGatewayAdapter/);
  assert.match(core,/getAccessToken:getLocAccessToken/);
  assert.match(core,/\/v1\/delegation/);
  assert.ok(legacy.includes('/functions/v1/loc-kysely'));
  assert.doesNotMatch(legacy,/loc-kysely-clerk/);
  assert.doesNotMatch(source,/createNeonPrimaryAdapter|createBackupPublicAdapter/);
});
test('production LOC routes every account login via Clerk, with no per-device toggle',()=>{
  const configured=readFileSync(new URL('../app/loc/providers/configured.mjs',import.meta.url),'utf8');
  const client=readFileSync(new URL('../app/loc/providers/clerk-gateway.mjs',import.meta.url),'utf8');
  assert.match(configured,/return createClerkGatewayAdapter\(\)/);
  assert.doesNotMatch(configured,/loc-auth-provider|NEXT_PUBLIC_LOC_IDENTITY_PROVIDER|createNeonPrimaryAdapter/);
  assert.doesNotMatch(client,/createSupabaseAdapter|autoRefreshToken:true|persistSession:true/);
  assert.ok(client.includes('/functions/v1/loc-kysely'));
  assert.doesNotMatch(client,/loc-kysely-clerk/);
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
test('MCP and SQL use distinct signed LOC delegations, without general SQL escalation',()=>{
  const edge=readFileSync(new URL('../supabase/functions/loc-kysely/index.ts',import.meta.url),'utf8');
  const contract=readFileSync(new URL('../app/loc/auth/delegation-contract.mjs',import.meta.url),'utf8');
  const worker=readFileSync(new URL('../workers/loc-authority/index.mjs',import.meta.url),'utf8');
  assert.match(edge,/delegationAudience\(body\)/);
  assert.match(contract,/loc-mcp/);
  assert.match(contract,/MCP delegation does not cover this operation/);
  assert.match(worker,/managedMcpInsert\(scopeid,row,Boolean\(status\.uid\),oauthToken\)/);
});
test('managed MCP sync accepts only an eight-flag private article without generated date',()=>{
  const edge=readFileSync(new URL('../supabase/functions/loc-kysely/index.ts',import.meta.url),'utf8');
  const worker=readFileSync(new URL('../workers/loc-authority/index.mjs',import.meta.url),'utf8');
  assert.match(edge,/const flags=\["statics","culture","search","trace","list","keyword","extract","others"\]/);
  assert.match(worker,/statics:false,culture:false,search:false/);
  assert.doesNotMatch(worker,/date:requestedTime\.slice/);
  assert.doesNotMatch(edge,/row\.statistics_able/);
});

test('Authority maps verified OAuth principal before issuing LOC claims',()=>{
  const edge=readFileSync(new URL('../supabase/functions/loc-kysely/index.ts',import.meta.url),'utf8');
  const worker=readFileSync(new URL('../workers/loc-authority/index.mjs',import.meta.url),'utf8');
  assert.match(worker,/verifyIdentityToken\(request,env\)/);
  assert.match(worker,/LOC_ROOT_MANAGEMENT_EMAIL/);
  assert.match(worker,/Verified identity email required for LOC delegation/);
  assert.match(edge,/verifyLocDelegation\(match\[1\],body\)/);
});
test('Kysely management actions replace retired business RPCs while database policy helpers remain',()=>{
  const edge=readFileSync(new URL('../supabase/functions/loc-kysely/index.ts',import.meta.url),'utf8');
  const runtime=readFileSync(new URL('../app/loc/providers/kysely-runtime.mjs',import.meta.url),'utf8');
  const account=readFileSync(new URL('../app/loc/use-account.js',import.meta.url),'utf8');
  assert.match(edge,/legacy RPC dispatch has been retired/);
  assert.doesNotMatch(edge,/silver\.can_manage_(global|scope|group)\(/);
  assert.doesNotMatch(runtime,/'silver\.(?:loc_catalog|get_my_scope_management)'/);
  assert.match(account,/\.managedAction\('manage',\{p_type:'self'\}\)/);
  const keywordEditor=readFileSync(new URL('../app/loc/LocKeywordManagement.jsx',import.meta.url),'utf8');
  const themeEditor=readFileSync(new URL('../app/loc/views/admin-panels/ThemeEditor.jsx',import.meta.url),'utf8');
  assert.doesNotMatch(keywordEditor+themeEditor,/\.rpc\('loc_catalog'/);
  assert.match(keywordEditor,/\.managedAction\('loc_admin_settings'/);
  assert.match(themeEditor,/\.managedAction\('loc_admin_settings'/);
});
test('SQL browser reuses LOC delegation for same OAuth token and cannot inherit it after account switch',async()=>{
  const source=readFileSync(new URL('../app/loc/providers/loc-gateway.mjs',import.meta.url),'utf8')
    .replace(/^import .*$/gm,'').replace(/^export /gm,'');
  let oauth='first.signed.token',calls=[];
  const create=new Function('createKyselyEdgeClient','URL','AbortSignal','process',
    source+'\n;return createLocGatewayAdapter;')(
    options=>options,URL,AbortSignal,process
  );
  const adapter=create({authorityUrl:'https://authority.example.org',
    gatewayUrl:'https://sql.example.org/v1/query',
    accountAdapter:{auth:{},getAccessToken:async()=>oauth},
    fetchImpl:async(url,init)=>{
      calls.push({url,source:JSON.parse(init.body),bearer:init.headers.authorization});
      return {ok:true,json:async()=>({
        access_token:'header.payload.signature',
        expires_at:Math.floor(Date.now()/1000)+300
      })};
    }});
  const scopeWrite={kind:'managed-write',payload:{p_table:'silver.lo3rwang_galaxy'}};
  const [a,b]=await Promise.all([
    adapter.authClient.getAccessToken(scopeWrite),
    adapter.authClient.getAccessToken(scopeWrite)]);
  assert.equal(a,'header.payload.signature');
  assert.equal(b,a);
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0].source,{
    audience:'sql',scopeid:'lo3rwang',actions:['manage']});
  assert.equal(calls[0].bearer,'Bearer first.signed.token');
  assert.equal(await adapter.authClient.getAccessToken(scopeWrite),a);
  assert.equal(calls.length,1);
  await adapter.authClient.getAccessToken({kind:'query',operation:'select',
    schema:'silver',table:'lo3rwang_galaxy'});
  assert.deepEqual(calls[1].source,{audience:'sql',identity:true});
  await adapter.authClient.getAccessToken({kind:'managed-action',name:'manage',
    args:{p_type:'self'}});
  assert.deepEqual(calls[2].source,{audience:'sql',self:true});
  await adapter.authClient.getAccessToken({kind:'managed-action',name:'manage',
    args:{p_type:'scope',p_id:'lrunes'}});
  assert.deepEqual(calls[3].source,{audience:'sql',scopeid:'lrunes',actions:['manage']});
  await adapter.authClient.getAccessToken({kind:'anchor',scopeid:'lrunes',type:'item',
    attr:{op:'catalog'}});
  assert.deepEqual(calls[4].source,{audience:'sql',scopeid:'lrunes',actions:['manage']});
  oauth='second.signed.token';
  await adapter.authClient.getAccessToken(scopeWrite);
  assert.equal(calls.length,6);
  assert.equal(calls[5].bearer,'Bearer second.signed.token');
});
