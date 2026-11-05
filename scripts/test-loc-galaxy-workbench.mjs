import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {scopeManagementUrl} from '../extensions/loc-galaxy/workspace-routes.mjs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('Scope imports and bulk editor open only fixed LOC-hosted management pages',()=>{
  for(const mode of ['import','bulk','article']){
    const url=new URL(scopeManagementUrl('lo3rwang',mode));
    assert.equal(url.origin,'https://loc.lo3rwang.cc');
    assert.equal(url.pathname,'/lo3rwang/search/manage/');
    assert.equal(url.searchParams.get('section'),mode==='article'?'publish':'import');
    assert.equal(url.searchParams.get('edit'),'1');
    assert.equal(url.searchParams.has('token'),false);
    if(mode==='bulk')assert.equal(url.hash,'#bulk-galaxy-visibility');
  }
  assert.equal(new URL(scopeManagementUrl('lrunes','import')).pathname,'/lrunes/search/manage/');
  const future=new URL(scopeManagementUrl('other','import'));
  assert.equal(future.pathname,'/scope-shell/search/manage/');
  assert.equal(future.searchParams.get('scopeid'),'other');
  assert.throws(()=>scopeManagementUrl('../mcp','import'));
  assert.throws(()=>scopeManagementUrl('lo3rwang','export'));
});

test('Extension owns only LOC issuer host permissions and hides Access Tokens from web pages',()=>{
  const manifest=JSON.parse(read('extensions/loc-galaxy/manifest.json'));
  const bg=read('extensions/loc-galaxy/background.mjs');
  const view=read('extensions/loc-galaxy/workbench.mjs');
  assert.deepEqual(manifest.permissions,['identity','storage']);
  assert.deepEqual(manifest.host_permissions,[
    'https://loc.lo3rwang.cc/*','https://precise-grackle-3371.clerk.accounts.dev/*'
  ]);
  assert.equal(manifest.content_scripts,undefined);
  assert.match(bg,/async function verifiedAccess\(scopeid\)/);
  assert.match(bg,/const token=await verifiedAccess\(scopeid\)/);
  assert.match(bg,/mcpTool\(token,'galaxy_link'/);
  assert.doesNotMatch(view,/refresh_token|access_token|client_secret/);
  assert.doesNotMatch(bg,/chrome.runtime.onMessageExternal/);
  assert.doesNotMatch(bg,/chrome.alarms/);
  assert.match(bg,/Date\.now\(\)-last<30000/);
  assert.match(read('extensions/loc-galaxy/workbench.html'),/Content-Security-Policy/);
});

test('Stage 2 workbench shares the original white Theme 7 login identity',()=>{
  const popup=read('extensions/loc-galaxy/popup.html');
  const css=read('extensions/loc-galaxy/workbench.css');
  const view=read('extensions/loc-galaxy/workbench.html');
  assert.match(popup,/id="workbench"/);
  assert.match(popup,/id="bulk"/);
  assert.match(view,/id="open-import"/);
  assert.match(view,/id="open-bulk"/);
  assert.match(view,/id="search-form"/);
  assert.match(css,/color-scheme:light/);
  assert.match(read('app/loc/BulkGalaxyVisibility.jsx'),/id="bulk-galaxy-visibility"/);
});
