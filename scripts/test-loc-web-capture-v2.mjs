import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Script} from 'node:vm';
const root=join(dirname(fileURLToPath(import.meta.url)),'../extensions/loc-web-capture-v2');
const text=name=>readFileSync(join(root,name),'utf8');
const manifest=JSON.parse(text('manifest.json'));

test('independent extension is MV3 and does not request identity or MCP privileges',()=>{
 assert.equal(manifest.manifest_version,3);
 assert.equal(manifest.background.service_worker,'background.js');
 assert.ok(!manifest.permissions.includes('identity'));
 assert.ok(!manifest.host_permissions.some(s=>s.includes('mcp.')));
 assert.ok(!manifest.host_permissions.some(s=>s.includes('clerk')));
 assert.deepEqual(manifest.host_permissions,['https://loc.lo3rwang.cc/*']);
});

test('extension scripts and vendored Readability compile',()=>{
 for(const name of ['background.js','content.js','popup.js','vendor/Readability.js'])
  assert.doesNotThrow(()=>new Script(text(name),{filename:name}));
});

test('only one IndexedDB queue; no OAuth token storage or Auth retries',()=>{
 const background=text('background.js');
 assert.match(background,/const DB_NAME='loc-web-capture-v2'/);
 assert.match(background,/const STORE='events'/);
 assert.match(background,/AUTO_CAPTURE_COUNT=10/);
 assert.match(background,/MAX_BYTES=600000/);
 assert.match(background,/credentials:'same-origin'/);
 assert.match(background,/world:'MAIN'/);
 assert.match(background,/locImportPaused/);
 assert.doesNotMatch(background,/launchWebAuthFlow|getToken\(|refresh_token|access_token|locOAuth|loc-mcp|mcp\.lo3rwang\.cc/);
});

test('recording uses explicit user selection and only observes selected visible DOM',()=>{
 const source=text('content.js');
 assert.match(source,/pick-record/);
 assert.match(source,/MutationObserver/);
 assert.match(source,/IntersectionObserver/);
 assert.match(source,/state\.observer\?\.disconnect\(\)/);
 assert.match(source,/new Readability\(document\.cloneNode\(true\)\)/);
});
