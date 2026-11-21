import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const build=readFileSync(new URL('../scripts/build-loc-static.mjs',import.meta.url),'utf8');
const entry=readFileSync(new URL('../app/loc/runtime/html-entry.jsx',import.meta.url),'utf8');
const check=readFileSync(new URL('../scripts/verify-loc-output.mjs',import.meta.url),'utf8');
test('one HTML document publisher and one optional React entry',()=>{
  assert.match(build,/interactive:abs\('app\/loc\/runtime\/html-entry\.jsx'\)/);
  assert.doesNotMatch(build,/entry-'\+i\+'\.jsx/);
  assert.doesNotMatch(build,/createRoot\(document\.getElementById/);
  assert.match(check,/Per-page React entrypoint emitted/);
});
test('actual HTML routes select features without a browser route table',()=>{
  assert.match(entry,/window\.location\.pathname/);
  assert.match(entry,/currentPage\(\)/);
  assert.match(entry,/AppShell/);
  assert.match(entry,/LocApp/);
  assert.match(entry,/PhoneWorkspace/);
  assert.match(entry,/ExtensionBridge/);
  assert.doesNotMatch(entry,/import\(.+page\.jsx/);
});
