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
  assert.ok(!native.includes('repository: EsotericVerse/lunarcus'));
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
