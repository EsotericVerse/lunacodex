import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('website bridge fallback is loaded, without broadening external origins',()=>{
  const manifest=JSON.parse(read('extensions/loc-galaxy/manifest.json'));
  const entry=read('extensions/loc-galaxy/background-entry.mjs');
  const fallback=read('extensions/loc-galaxy/website-grant-fallback.mjs');
  assert.equal(manifest.version,'0.6.3');
  assert.equal(manifest.background.service_worker,'background-entry.mjs');
  assert.deepEqual(manifest.externally_connectable.matches,['https://loc.lo3rwang.cc/*']);
  assert.match(entry,/import '\.\/background-core\.mjs'/);
  assert.match(entry,/import '\.\/website-grant-fallback\.mjs'/);
  assert.match(fallback,/if\(message\?\.type!==/);
  assert.match(fallback,/chrome\.tabs\.get\(record\.tabId\)/);
  assert.match(fallback,/u\.searchParams\.get\('nonce'\)===nonce/);
  assert.match(fallback,/u\.searchParams\.get\('scopeid'\)===scopeid/);
  assert.match(fallback,/verifyScopeAuthorization\(token,scopeid\)/);
  assert.match(fallback,/await chrome\.storage\.session\.remove\(PENDING\)/);
  assert.doesNotMatch(fallback,/document\.cookie|localStorage/);
});

test('0.6.2 has exactly one active website external grant listener',()=>{
 const entry=read('extensions/loc-galaxy/background-entry.mjs');
 const core=read('extensions/loc-galaxy/background-core.mjs');
 const site=read('extensions/loc-galaxy/website-grant-fallback.mjs');
 assert.doesNotMatch(entry,/import '\.\/background\.mjs'/);
 assert.doesNotMatch(core,/onMessageExternal\.addListener/);
 assert.equal((site.match(/onMessageExternal\.addListener/g)||[]).length,1);
 assert.doesNotMatch(site,/if\(sender\.tab\?\.id\|\|/);
});

test('Clerk token acquisition waits for a verified Extension communication probe',()=>{
 const bridge=read('public/extension/website-bridge.mjs');
 const listener=read('extensions/loc-galaxy/website-grant-fallback.mjs');
 assert.match(bridge,/type:'locGalaxy\.bridgeProbe'/);
 assert.match(bridge,/if\(!probe\.ok\)throw Error/);
 assert.match(bridge,/probe\.data\?\.version!=='0\.6\.3'/);
 assert.ok(bridge.indexOf("type:'locGalaxy.bridgeProbe'")<bridge.indexOf("const clerk=await loadClerk()"));
 assert.match(listener,/message\?\.type!=='locGalaxy\.bridgeProbe'/);
 assert.match(listener,/version:chrome\.runtime\.getManifest\(\)\.version/);
 assert.match(listener,/await knownTab\(pending,nonce,scopeid\)/);
 assert.match(listener,/await knownTab\(active,nonce,scopeid\)/);
});
