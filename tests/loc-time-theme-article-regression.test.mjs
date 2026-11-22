import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {managementHeroSlot} from '../app/loc/blocks/home-block-model.js';

const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('management TimeAnchor projection feeds a real Era/Period/Date river',()=>{
  const query=source('app/loc/culture/query.js');
  assert.match(query,/const editorRows=await readManagedTimeRecords\(scope\.time,\{signal\}\)/);
  assert.match(query,/const projected=projectScopeTimeRecords\(scope\.id,editorRows\)/);
  assert.match(query,/const parts=cultureParts\(projected,scope\.id\)/);
  assert.match(query,/const openRange=openPeriodRangeFromRows\(scope\.id,projected\)/);
  assert.match(query,/entry_key:type\+': '\+id|entry_key:type\+':'\+id/);
  assert.match(query,/entry_type:type/);
  assert.match(query,/resolveTimeTrace\(row\.anchor_ids,eventMap\)/);
});

test('author Article Control Hero has stable identity even before live blocks arrive',()=>{
  const slot=managementHeroSlot('/lo3rwang/search/manage','lo3rwang',false,'search');
  assert.equal(slot.label,'文章管理');
  assert.equal(slot.page,'ScopeAdvSearch');
  assert.equal(managementHeroSlot('/lo3rwang/search','lo3rwang',false,'search'),null);
});

test('scope Theme preview is immediate, ephemeral and saved theme is applied',()=>{
  const panel=source('app/loc/scope/ScopeSettingsPanel.jsx');
  const shell=source('app/AppShell.jsx');
  const css=source('app/modular/theme-registry.js');
  assert.match(panel,/broadcastTheme\('loc-scope-theme-preview',scopeId,value\)/);
  assert.match(panel,/broadcastTheme\('loc-scope-theme-preview-clear',scopeId\)/);
  assert.match(panel,/broadcastTheme\('loc-scope-theme-committed',scopeId,theme\)/);
  assert.match(panel,/broadcastTheme\('loc-scope-theme-saved',scopeId,nextTheme\)/);
  assert.match(shell,/window\.addEventListener\('loc-scope-theme-preview',onPreview\)/);
  assert.match(shell,/window\.addEventListener\('loc-scope-theme-preview-clear',onClear\)/);
  assert.match(shell,/rememberCommittedScopeTheme\(scopeId,themeId\)/);
  assert.match(shell,/void activatePublishedTheme\(effectiveThemeId\)/);
  assert.match(css,/\'\/themes\/\'\+themeId\+\'\.css\'/);
});

test('confirmed lo3rwang theme change is also present in published JS',()=>{
  const routes=source('app/modular/routing/scope-route-index.js');
  assert.match(routes,/"scope_id":"lo3rwang".*?"theme":"theme-2"/);
  assert.doesNotMatch(routes,/"scope_id":"lo3rwang".*?"theme":"theme-8"/);
});
