import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const build=readFileSync(new URL('../scripts/build-loc-static.mjs',import.meta.url),'utf8');
const entry=readFileSync(new URL('../app/loc/runtime/html-entry.jsx',import.meta.url),'utf8');
const render=readFileSync(new URL('../scripts/render-public-home.jsx',import.meta.url),'utf8');
const check=readFileSync(new URL('../scripts/verify-loc-output.mjs',import.meta.url),'utf8');
test('native HTML pages contain their own feature slot',()=>{
  assert.match(build,/renderPublicFeatureFrame/);
  assert.match(render,/id="loc-interactive-root"/);
  assert.match(render,/PublicNavigation scopeId/);
  assert.match(render,/PublicDock scopeId/);
  assert.doesNotMatch(build,/entry-'\+i\+'\.jsx/);
  assert.match(check,/Per-page React entrypoint emitted/);
});
test('on-demand React does not mount an AppShell or a router',()=>{
  assert.match(entry,/document\.body\.dataset/);
  assert.match(entry,/document\.getElementById\('loc-interactive-root'\)/);
  assert.match(entry,/createRoot\(node\)/);
  assert.doesNotMatch(entry,/import AppShell/);
  assert.match(entry,/LocFeature/);
  assert.match(entry,/PhoneWorkspace/);
  assert.match(entry,/ExtensionBridge/);
});
test('LRS links are published HTML instead of React redirects',()=>{
  assert.match(build,/outbound\?'<script>/);
  assert.match(check,/LRS outbound HTML must link directly/);
});
