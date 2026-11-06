import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {canonicalImportSourceName,inferImportSourceFromFilename} from '../app/loc/source-name.mjs';
import {grantHomeEditorAccess,readHomeEditorAccess,clearHomeEditorAccess} from '../app/loc/home-edit-access.mjs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('system brand source spellings and custom Scope labels',()=>{
  assert.equal(canonicalImportSourceName('FaceBook',['Facebook']),'Facebook');
  assert.equal(canonicalImportSourceName('THREADS',['Threads']),'Threads');
  assert.equal(canonicalImportSourceName('MYBLOG',[],['MyBlog']),'MyBlog');
  assert.equal(canonicalImportSourceName('My Words'),'My Words');
  assert.equal(inferImportSourceFromFilename('threads_2026.json'),'Threads');
});
test('URL edit parameter cannot bootstrap a public editor',()=>{
  const culture=read('app/modular/features/Culture.jsx');
  const search=read('app/modular/features/Search.jsx');
  const entry=read('app/loc/ManagementAccess.jsx');
  assert.match(culture,/canUseScopeEditor&&\(pathname\.endsWith\('\/culture\/manage'\)/);
  assert.doesNotMatch(culture,/if\(isTimeEditingView.*editDock\?\.begin/);
  assert.match(search,/if\(!managementMode&&\(!publicScopeEditing\|\|result.scopeId!==scopeId\)\)return/);
  assert.match(entry,/granted\(account\.authorizer,scopeId,level\)/);
});

test('home editor re-entry requires the verified entry marker and expires',()=>{
  const map=new Map();
  const storage={getItem:key=>map.get(key)||null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)};
  grantHomeEditorAccess(storage,'lo3rwang','u-1',10000);
  assert.equal(readHomeEditorAccess(storage,10001)?.scopeId,'lo3rwang');
  assert.equal(readHomeEditorAccess(storage,10000+7200000),null);
  clearHomeEditorAccess(storage);
  assert.equal(readHomeEditorAccess(storage,10001),null);
  const source=read('app/loc/HomeEditModeRestore.jsx');
  // The marker's own TTL (edit-session-ttl.mjs) is the trust window now:
  // restoring edit mode across a static-export page reload must NOT repeat
  // the live api.manage RPC that ScopeHomeEditEntry.jsx already ran once
  // at the single unified entry point. A live re-check here on every page
  // mount was what made entering edit mode trigger a fresh DB query on
  // every subsequent page within the same still-valid editing session.
  assert.doesNotMatch(source,/useAccount/);
  assert.doesNotMatch(source,/\.refresh\(\)/);
  assert.match(source,/marker\.scopeId!==scopeId/);
  assert.match(source,/dock\?\.begin\(scopeId\)/);
});
