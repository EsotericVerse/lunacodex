import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isChunkLoadFailure,recoverChunkOnce} from '../app/loc/chunk-recovery.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const browser=(url,confirm=true)=>{
  const u=new URL(url),memory=new Map();
  let reloads=0,prompts=0;
  return {
    location:{protocol:u.protocol,pathname:u.pathname,search:u.search,
      reload:()=>{reloads++;}},
    sessionStorage:{getItem:key=>memory.get(key)||null,setItem:(key,v)=>memory.set(key,v)},
    confirm:()=>{prompts++;return confirm;},
    get reloads(){return reloads;},get prompts(){return prompts;}
  };
};
test('manage links use a fresh static document, not RSC navigation',()=>{
  const link=read('app/modular/ScopeLink.jsx');
  assert.match(link,/isManagementHref\(href\)/);
  assert.match(link,/<a href=\{href\}/);
  assert.match(link,/new URL\(String\(href\)/);
});
test('real failed chunks recover once; unrelated errors do not',()=>{
  const w=browser('https://loc.example/lo3rwang/manage/?section=placeManage');
  const chunk=Error('Failed to load chunk /_next/static/chunks/missing.js from module');
  assert.equal(isChunkLoadFailure(chunk),true);
  void recoverChunkOnce(chunk,{browser:w,now:10000000});
  assert.equal(w.reloads,1);
  assert.throws(()=>recoverChunkOnce(chunk,{browser:w,now:10000001}),/Failed to load chunk/);
  assert.equal(w.reloads,1);
  const missingRpc=Error('404: rpc/preview_timeline_place_page_json');
  assert.equal(isChunkLoadFailure(missingRpc),false);
  assert.throws(()=>recoverChunkOnce(missingRpc,{browser:w,now:12000000}),/404/);
});
test('editing requires consent, declining never reloads or locks out',()=>{
  const w=browser('https://loc.example/lo3rwang/manage/?edit=1',false);
  const error=Error('ChunkLoadError: Loading chunk 12 failed');
  assert.throws(()=>recoverChunkOnce(error,{browser:w,now:10000000}),/ChunkLoadError/);
  assert.equal(w.prompts,1);
  assert.equal(w.reloads,0);
});
test('non-https native file views never refresh',()=>{
  const w=browser('file:///local/manage/index.html');
  assert.throws(()=>recoverChunkOnce(Error('ChunkLoadError'),{browser:w}),/ChunkLoadError/);
  assert.equal(w.reloads,0);
});
test('management links select real sections and preserve legacy links',()=>{
  const shell=read('app/AppShell.jsx');
  const management=read('app/loc/ScopeManagement.jsx');
  assert.match(shell,/editTabHref\('manage','section','placeManage'\)/);
  assert.match(shell,/editTabHref\('trace\/manage','section','traceMap'\)/);
  assert.match(management,/traceAnchor:isLoc\?'traceMap':'placeManage'/);
});
test('both management lazy entries use the same recovery',()=>{
  assert.match(read('app/loc/LocApp.jsx'),/import\('\.\/ScopeManagement'\)\.catch\(recoverChunkOnce\)/);
  assert.match(read('app/loc/ScopeManagement.jsx'),/import\('\.\/PlaceManagement'\)\.catch\(recoverChunkOnce\)/);
  assert.match(read('app/AppShell.jsx'),/window\.addEventListener\('unhandledrejection',recover\)/);
});

test('LunaRunes keyword editor uses the canonical scoped management route',()=>{
  const shell=read('app/AppShell.jsx');
  const page=read('app/modular/features/KeywordSettings.jsx');
  const route=read('app/lrunes/statics/manage/page.jsx');
  const entry=read('app/loc/ManagementAccess.jsx');
  assert.match(shell,/editTabHref\('statics\/manage','edit','1'\)/);
  assert.match(route,/forcedView="keywords" forcedScope="lrunes"/);
  assert.match(page,/account\.canManageScopeSync\(scopeId\)/);
  assert.match(entry,/canManageScopeSync\(id\)/);
});

test('same-origin edit navigation stays client-side and keeps the editor session',()=>{
  const dock=read('app/modular/edit-dock.jsx');
  assert.match(dock,/url\.origin!==window\.location\.origin/);
  assert.match(dock,/router\.replace\(url\.pathname\+url\.search\+url\.hash/);
  assert.doesNotMatch(dock,/\/\(\?:manage\|culture\|trace\)/);
});

test('all management pages restore editor access through one verified entry',()=>{
  const app=read('app/loc/LocApp.jsx');
  const entry=read('app/loc/ManagementAccess.jsx');
  const manager=read('app/loc/ScopeManagement.jsx');
  assert.match(app,/managementRoute\?<ManagementAccess/);
  assert.match(entry,/editorSessionStatus\(window\.sessionStorage\)\.expired/);
  assert.match(entry,/dock\?\.begin\(scopeId\)/);
  assert.match(entry,/granted\(verification\.authorizer,scopeId,level\)/);
  assert.doesNotMatch(manager,/renewEditorSession|sessionExpired|get_my_scope_management/);
});
test('expired management entry requires scenic login and fresh Scope grant',()=>{
  const entry=read('app/loc/ManagementAccess.jsx');
  const login=read('public/login/index.html');
  const ttl=read('app/loc/edit-session-ttl.mjs');
  assert.ok(entry.includes('const fromLogin=window.sessionStorage.getItem(LOGIN_RETURN_KEY)===path'));
  assert.ok(entry.includes('verifyManagementEntry(fromLogin?account.refresh:check)'));
  assert.ok(entry.includes('if(fromLogin&&result?.user&&granted(result.authorizer,scopeId,level))'));
  assert.ok(entry.indexOf('granted(result.authorizer,scopeId,level)')<
    entry.indexOf('clearEditorSession(window.sessionStorage)'));
  assert.ok(entry.includes('touchEditorSession(window.sessionStorage)'));
  assert.ok(entry.includes("window.location.replace('/login/index.html?return_to='"));
  assert.ok(login.includes('sessionStorage.setItem(LOGIN_RETURN_KEY,path)'));
  assert.match(ttl,/EDIT_IDLE_TTL_MS=30\*60\*1000/);
  assert.match(ttl,/EDIT_SESSION_TTL_MS=2\*60\*60\*1000/);
});

test('cancel exits management to the real public document after clearing editor state',()=>{
  const dock=read('app/modular/edit-dock.jsx');
  const start=dock.indexOf('const discard=useCallback(');
  const stop=dock.indexOf('const switchTo=useCallback(',start);
  assert.ok(start>=0&&stop>start);
  const cancel=dock.slice(start,stop);
  assert.match(cancel,/const destination=new URL\(String\(target\),window\.location\.href\)/);
  assert.match(cancel,/end\(\);\s*window\.location\.assign\(destination\.href\)/);
  assert.doesNotMatch(cancel,/navigate\(target\)/);
});

test('Settings Feature tab recovers only missing deployment chunks, not API 404s',()=>{
  const settings=read('app/loc/GlobalSettings.jsx');
  const feature=read('app/loc/FeatureSettingsPage.jsx');
  const route=read('app/settings/features/page.jsx');
  const inline=read('app/modular/ManagementSectionNav.jsx');
  assert.match(settings,/import\('\.\/FeatureSettingsPage'\)\.catch\(recoverChunkOnce\)/);
  assert.match(feature,/import\('\.\/LocUserSettingsPanel'\)\.catch\(recoverChunkOnce\)/);
  assert.match(settings,/activeSection==='features'\?<FeatureSettingsPage embedded\/>/);
  assert.match(inline,/onClick=\{\(\)=>\{if\(!selected\)onChange\(item\.value\);\}\}/);
  assert.match(route,/export default function SettingsFeaturesPage/);
  assert.equal(isChunkLoadFailure(Error('HTTP 404: function endpoint not found')),false);
});
