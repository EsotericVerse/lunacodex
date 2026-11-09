import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {Script} from 'node:vm';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const base='extensions/loc-galaxy-link/';
const bg=read(base+'background.js');
const content=read(base+'content.js');
const manifest=JSON.parse(read(base+'manifest.json'));
test('only one named galaxy-link extension with all right-click actions',()=>{
 assert.equal(manifest.name,'LOC galaxy-link｜LOC 彩虹橋');
 assert.equal(manifest.version,'0.2.1');
 assert.equal(Object.hasOwn(manifest.action,'default_popup'),false);
 assert.equal(manifest.background.service_worker,'background.js');
 assert.ok(manifest.permissions.includes('identity'));
 assert.ok(manifest.permissions.includes('contextMenus'));
 assert.ok(manifest.permissions.includes('tabs'));
 for(const menu of ['MENU_PAGE','MENU_SELECTION','MENU_AREA','MENU_RECORD','MENU_PAUSE','MENU_RESUME','MENU_STOP'])assert.ok(bg.includes(menu));
 assert.equal(existsSync(new URL('../extensions/loc-web-capture-v2/',import.meta.url)),false);
});
test('all extension scripts compile and Readability library is included',()=>{
 for(const script of ['background.js','content.js','options.js','vendor/Readability.js'])
  assert.doesNotThrow(()=>new Script(read(base+script),{filename:script}));
 assert.ok(existsSync(new URL('../'+base+'vendor/LICENSE.md',import.meta.url)));
});
test('single LOC Auth PKCE and durable Queue are shared across every capture mode',()=>{
 assert.match(bg,/const DB_NAME='loc-channel1-queue'/);
 assert.match(bg,/const STORE='pending',ACK_STORE='acknowledged'/);
 assert.match(bg,/indexedDB\.open\(DB_NAME,2\)/);
 assert.match(bg,/chrome\.identity\.launchWebAuthFlow/);
 assert.match(bg,/code_challenge_method:'S256'/);
 assert.match(bg,/grant_type:'refresh_token'/);
 assert.match(bg,/validateArticleReceipts\(receipt\.articles,batch\.records\)/);
 assert.match(bg,/await removeEvents\(group\)/);
 assert.match(bg,/const scopeid of \[\.\.\.new Set\(rows\.map/);
 assert.match(bg,/records:group\.map\(\(\{scopeid:localScope,\.\.\.record\}\)/);
 assert.doesNotMatch(bg,/__locGalaxyLinkImport|loc-web-capture-v2|locTab|LOC_BRIDGE/);
});
test('loaded conversations, social posts, selected areas and live recording coexist',()=>{
 assert.match(content,/function conversationTurns\(/);
 assert.match(content,/chatgpt\\.com/);
 assert.match(content,/MutationObserver/);
 assert.match(content,/IntersectionObserver/);
 assert.match(content,/new Readability\(document\.cloneNode\(true\)\)/);
 assert.match(content,/msg\.type==='page\.pause'/);
 assert.match(content,/msg\.type==='page\.resume'/);
 assert.match(bg,/function captureSourceMatches\(/);
 assert.match(bg,/chrome\.scripting\.executeScript/);
 assert.match(bg,/function toEvents\(/);
 assert.match(bg,/sendViaAuth\(/);
});
test('a not-yet-upgraded LOC Auth never routes another Scope into default',()=>{
 const worker=read('workers/loc-authority/native-oauth.mjs');
 assert.match(worker,/requestedScope=new URL\(request\.url\)\.searchParams\.get\('scopeid'\)/);
 assert.match(worker,/loc_import_scope_routing:'query-v1'/);
 assert.match(bg,/scopeid!=='lo3rwang'&&config\.supports_scope_routing!==true/);
 assert.match(bg,/endpoint\.searchParams\.set\('scopeid',scopeid\)/);
});
test('same-origin and origin-bound capture plus UID receipts prevent data loss',()=>{
 assert.match(bg,/sender\.id!==chrome\.runtime\.id/);
 assert.match(bg,/captureSourceMatches\(sender\.tab\.url,item\?\.url\)/);
 assert.match(bg,/if\(!received\.has\(key\)\)throw contractError/);
 assert.match(bg,/await sendViaAuth\(scopeid,batch,token,settings\.locConfig\)/);
 assert.match(bg,/await removeEvents\(group\)/);
});

test('Chrome icon opens preferences; all capture commands stay in native right-click menu',()=>{
 assert.match(bg,/chrome\.action\.onClicked\.addListener\(\(\)=>chrome\.runtime\.openOptionsPage\(\)\)/);
 assert.match(bg,/chrome\.contextMenus\.onClicked\.addListener/);
 assert.match(bg,/parentId:MENU_ROOT/);
 assert.doesNotMatch(read(base+'options.html'),/id="capture"|id="record"|id="pause"|id="resume"|id="stop"/);
 assert.ok(!existsSync(new URL('../'+base+'popup.html',import.meta.url)));
 assert.ok(!existsSync(new URL('../'+base+'popup.js',import.meta.url)));
 assert.match(read(base+'options.html'),/網頁右鍵/);
 assert.match(read(base+'options.js'),/locTargetScope/);
 assert.match(read(base+'options.js'),/locIncludeAssistant/);
});
