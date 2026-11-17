import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';

const exists=path=>existsSync(new URL('../'+path,import.meta.url));
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('LOC is the only full website and native IPA build owner',()=>{
  assert.ok(exists('.github/workflows/ios-device-build.yml'));
  assert.ok(exists('.github/workflows/deploy-pages.yml'));
  assert.ok(!exists('services/workers/lunarcus'));
  assert.ok(!exists('services/workers/loc-authority'));
  assert.ok(!exists('.github/workflows/deploy-lunarcus-auth.yml'));
  const native=read('.github/workflows/ios-device-build.yml');
  assert.ok(native.includes('workflow_dispatch:'));
  // LOC owns the IPA build. A pinned, read-only LAS source checkout is
  // intentional for the original native Hero; it must never deploy LAS Auth.
  assert.match(native,/repository: EsotericVerse\\/lunarcus\\s*\\n\\s*ref: [0-9a-f]{40}\\s*\\n\\s*path: las-source\\s*\\n\\s*persist-credentials: false/);
  assert.doesNotMatch(native,/\\b(?:auth:deploy|mcp:deploy|wrangler\\s+(?:deploy|publish))\\b/i);
});

test('LOC remains one Cloudflare Pages build; LAS triggers are external',()=>{
  const fallback=read('.github/workflows/deploy-pages.yml');
  assert.ok(fallback.includes('workflow_dispatch:'));
  assert.ok(!/^\s+push:\s*$/m.test(fallback),'Do not auto-publish duplicate GitHub Pages build');
  const guard=read('scripts/check-workflow-triggers.rb');
  assert.ok(guard.includes("only workflow_dispatch is permitted for this workflow"));
  const pkg=JSON.parse(read('package.json'));
  assert.ok(pkg.scripts['build:static']);
  assert.ok(!Object.keys(pkg.scripts).some(name=>name==='auth:deploy'||name==='mcp:deploy'),
    'Do not compile/deploy the independent LAS Workers from LOC');
});

test('LAS business bridge remains in LOC without a parallel LAS Auth runtime',()=>{
  const bridge=read('functions/api/las-native.js');
  assert.ok(bridge.includes('handleNativeLocOperation'));
  assert.ok(bridge.includes("const HOST='loc.lo3rwang.cc'"));
  assert.ok(bridge.includes("const RESOURCE='https://mcp.lo3rwang.cc/api/loc-native'"));
  assert.ok(!bridge.includes('LAS_DATABASE_URL'));
});


// LAS owns the public MCP protocol server. LOC Pages may expose only its own
// fixed business/data bridge and its independently authorized provider controls.
test('Retired LOC Pages MCP gateway cannot be rebuilt or reactivated',()=>{
  const retiredEntries=[
    'functions/index.js',
    'functions/mcp.js',
    'functions/.well-known/oauth-protected-resource.js',
    'functions/.well-known/oauth-protected-resource/mcp.js'
  ];
  const retiredModules=[
    'app/loc/mcp/router.mjs',
    'app/loc/mcp/business-actions.mjs',
    'app/loc/mcp/gateway-qos.mjs',
    'app/loc/mcp/stateless-transport.mjs',
    'app/loc/mcp/tool-contracts.mjs',
    'app/loc/mcp/private-galaxy.mjs',
    'app/loc/mcp/loc-access.mjs'
  ];
  for(const path of [...retiredEntries,...retiredModules])
    assert.ok(!exists(path),'LOC must not bundle retired inbound MCP server: '+path);
  const routeConfig=JSON.parse(read('public/_routes.json'));
  for(const route of ['/','/mcp',
    '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-protected-resource/mcp'])
    assert.ok(!routeConfig.include.includes(route),
      'LOC Pages must not handle LAS MCP protocol route '+route);
  for(const route of ['/api/las-native','/api/loc-native',
    '/api/loc-public-content','/api/loc-public-query'])
    assert.ok(routeConfig.include.includes(route),
      'Keep LOC business API route '+route);
  for(const file of ['functions/api/las-native.js',
    'functions/api/loc-native.js','app/loc/mcp/native-operations.mjs',
    'app/loc/mcp/native-kysely.mjs'])
    assert.ok(exists(file),'Keep LOC portable business/data service '+file);
  // Provider/OAuth/transport implementations are LAS-owned; retaining
  // their source in LOC would duplicate a second MCP runtime on Pages.
  for(const path of [
    'functions/api/mcp-provider.js','functions/api/mcp-provider-extension.js',
    'functions/api/mcp-provider-callback.js',
    'functions/.well-known/loc-mcp-client.js',
    ...['upstream-oauth.mjs','upstream-policy.mjs',
      'upstream-providers.mjs','upstream-sse.mjs','upstream-tools.mjs',
      'upstream-vault.mjs','extension-sso.mjs'].map(name=>'app/loc/mcp/'+name)
  ]) assert.ok(!exists(path),'No duplicate LAS-owned Provider code in LOC: '+path);
  for(const route of ['/api/mcp-provider','/api/mcp-provider-extension',
    '/api/mcp-provider-callback','/.well-known/loc-mcp-client'])
    assert.ok(!routeConfig.include.includes(route),
      'No LOC Pages upstream Provider route after LAS migration: '+route);
});
