import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('LOC management actions are explicitly named and validated',()=>{
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
  const code=readFileSync(new URL('../app/loc/gateway/sql-handler.ts',import.meta.url),'utf8');
  assert.match(code,/verifyLocDelegation\(match\[1\],body\)/);
  assert.match(code,/verifyDelegationBoundary\(payload,body,/);
  assert.doesNotMatch(code,/authClient\.auth\.getUser\(token\)/);
});

test('LOC browser adapter exchanges native OAuth into scoped SQL delegation',()=>{
  const configured=readFileSync(new URL('../app/loc/providers/configured.mjs',import.meta.url),'utf8');
  const core=readFileSync(new URL('../app/loc/providers/loc-gateway.mjs',import.meta.url),'utf8');
  const browser=readFileSync(new URL('../app/loc/auth/loc-browser.mjs',import.meta.url),'utf8');
  assert.ok(configured.includes('createLocAccountAdapter'));
  assert.ok(configured.includes('createLocGatewayAdapter'));
  assert.ok(core.includes('getAccessToken:getLocAccessToken'));
  assert.ok(core.includes('/v1/delegation'));
  assert.ok(browser.includes('/v1/auth/session'));
  assert.doesNotMatch(configured,/NEXT_PUBLIC_LOC_IDENTITY_PROVIDER/);
});

test('production LOC login no longer loads vendor Auth SDKs',()=>{
  const configured=readFileSync(new URL('../app/loc/providers/configured.mjs',import.meta.url),'utf8');
  const login=readFileSync(new URL('../public/login/index.html',import.meta.url),'utf8');
  assert.ok(configured.includes('return createLocGatewayAdapter({'));
  assert.match(configured,/createLocAccountAdapter/);
  assert.ok(login.includes('https://auth.lo3rwang.cc'));
  assert.match(login,/new URL\('\/oauth\/login',AUTHORITY\)/);
});

test('MCP and SQL use distinct signed LOC delegations, without general SQL escalation',()=>{
  const edge=readFileSync(new URL('../app/loc/gateway/sql-handler.ts',import.meta.url),'utf8');
  const contract=readFileSync(new URL('../app/loc/auth/delegation-contract.mjs',import.meta.url),'utf8');
  const worker=readFileSync(new URL('../workers/loc-authority/index.mjs',import.meta.url),'utf8');
  assert.match(edge,/delegationAudience\(body\)/);
  assert.match(contract,/loc-mcp/);
  assert.match(contract,/MCP delegation does not cover this operation/);
  assert.match(worker,/managedMcpInsert\(scopeid,row,Boolean\(status\.uid\),oauthToken\)/);
});

test('managed MCP sync accepts only an eight-flag private article without generated date',()=>{
  const edge=readFileSync(new URL('../app/loc/gateway/sql-handler.ts',import.meta.url),'utf8');
  const worker=readFileSync(new URL('../workers/loc-authority/index.mjs',import.meta.url),'utf8');
  assert.match(edge,/const flags=\["statics","culture","search","trace","list","keyword","extract","others"\]/);
  assert.match(worker,/statics:false,culture:false,search:false/);
  assert.doesNotMatch(worker,/date:requestedTime\.slice/);
  assert.doesNotMatch(edge,/row\.statistics_able/);
});


test('Authority maps verified OAuth principal before issuing LOC claims',()=>{
  const edge=readFileSync(new URL('../app/loc/gateway/sql-handler.ts',import.meta.url),'utf8');
  const worker=readFileSync(new URL('../workers/loc-authority/index.mjs',import.meta.url),'utf8');
  assert.match(worker,/verifyNativeOAuth\(request,env,WEB_AUDIENCE\)/);
  assert.match(worker,/LOC_RECOVERY_ROOT_LOC_SUBJECTS/);
  assert.match(worker,/Verified identity email required for LOC delegation/);
  assert.match(edge,/verifyLocDelegation\(match\[1\],body\)/);
});

test('Kysely management actions replace retired business RPCs while database policy helpers remain',()=>{
  const edge=readFileSync(new URL('../app/loc/gateway/sql-handler.ts',import.meta.url),'utf8');
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

test('SQL browser reuses delegation but invalidates cache on account switch',async()=>{
  const source=readFileSync(new URL('../app/loc/providers/loc-gateway.mjs',import.meta.url),'utf8')
    .replace(/^import .*$/gm,'').replace(/^export /gm,'');
  let oauth='first.signed.token';
  const delegations=[],sqlCalls=[];
  const create=new Function('createKyselyEdgeClient','URL','AbortSignal','process',
    source+'\n;return createLocGatewayAdapter;')(
    options=>options,URL,AbortSignal,process
  );
  const adapter=create({authorityUrl:'https://authority.example.org',
    gatewayUrl:'https://sql.example.org/v1/query',
    accountAdapter:{auth:{},getAccessToken:async()=>oauth},
    fetchImpl:async(url,init)=>{
      if(String(url).endsWith('/v1/delegation')){
        delegations.push({url:String(url),body:JSON.parse(init.body),
          bearer:init.headers.authorization});
        return {ok:true,status:200,json:async()=>({
          access_token:'header.payload.signature',
          expires_at:Math.floor(Date.now()/1000)+300
        })};
      }
      sqlCalls.push({url:String(url),bearer:init.headers.authorization,
        body:JSON.parse(init.body)});
      return {ok:true,status:200,headers:new Headers(),
        json:async()=>({data:[{uid:'aB12cD34'}],count:1})};
    }});
  const call=(kind)=>adapter.authClient.getAccessToken(kind);
  // The SQL transport supplies tokens internally rather than exposing them
  // as a public client method.
  const query=()=>adapter.authClient.schema('silver').from('lo3rwang_galaxy')
    .select('uid').limit(1);
  // Test the internal access-token callback by routing real SQL requests.
  const gateway=create({authorityUrl:'https://authority.example.org',
    gatewayUrl:'https://sql.example.org/v1/query',
    accountAdapter:{auth:{},getAccessToken:async()=>oauth},
    fetchImpl:async(url,init)=>{
      if(String(url).endsWith('/v1/delegation')){
        delegations.push({url:String(url),body:JSON.parse(init.body),
          bearer:init.headers.authorization});
        return {ok:true,status:200,json:async()=>({
          access_token:'header.payload.signature',
          expires_at:Math.floor(Date.now()/1000)+300
        })};
      }
      sqlCalls.push({url:String(url),bearer:init.headers.authorization,
        body:JSON.parse(init.body)});
      return {ok:true,status:200,headers:new Headers(),
        json:async()=>({data:[{uid:'aB12cD34'}],count:1})};
    }});
  // Use the injected stub client to obtain internal delegated token through
  // its callback, keeping the production SQL client API unchanged.
  const identity={kind:'query',operation:'select',schema:'silver',table:'lo3rwang_galaxy'};
  const token=await gateway.authClient.getAccessToken(identity);
  assert.equal(token,'header.payload.signature');
  assert.equal(delegations.length,1);
  assert.deepEqual(delegations[0].body,{audience:'sql',identity:true});
  assert.equal(await gateway.authClient.getAccessToken(identity),token);
  assert.equal(delegations.length,1);
  const write={kind:'managed-write',payload:{p_table:'silver.lo3rwang_galaxy'}};
  await gateway.authClient.getAccessToken(write);
  assert.deepEqual(delegations[1].body,
    {audience:'sql',scopeid:'lo3rwang',actions:['manage']});
  await gateway.authClient.getAccessToken({kind:'managed-action',name:'manage',
    args:{p_type:'self'}});
  assert.deepEqual(delegations[2].body,{audience:'sql',self:true});
  await gateway.authClient.getAccessToken({kind:'managed-action',name:'manage',
    args:{p_type:'scope',p_id:'lrunes'}});
  assert.deepEqual(delegations[3].body,{audience:'sql',scopeid:'lrunes',actions:['manage']});
  oauth='second.signed.token';
  await gateway.authClient.getAccessToken(identity);
  assert.equal(delegations.length,5);
  assert.equal(delegations[4].bearer,'Bearer second.signed.token');
});
