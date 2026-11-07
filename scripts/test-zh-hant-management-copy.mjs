import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// This suite checks the Chinese copy itself, not layout or business IDs.
// Keep source keys/permission codes unchanged when editing visible labels.
const root=new URL('../',import.meta.url);
const read=path=>readFileSync(new URL(path,root),'utf8');
const dictionary=name=>{
  const source=read('app/i18n/sections/'+name+'.zh_tw.js');
  // Section modules are JSON-shaped ESM object literals (trailing commas allowed).
  return JSON.parse(source.replace(/^export default\s*/u,'')
    .replace(/;\s*$/u,'').replace(/,(\s*[}\]])/gu,'$1'));
};

test('Chinese Group grant copy has meaningful labels for the whole authorization flow',()=>{
  const copy=dictionary('uiExtra.scopeSettings');
  for(const key of ['groupTitle','groupIntro','groupMemberScope','groupLocSubject',
    'groupExpires','groupPermissions','groupGrant','groupCurrentGrants',
    'groupNoGrants','groupLinkTitle','groupLinkIntro','groupLink','groupRevoke',
    'databaseTitle','databaseDesc','databaseEndpoint','databaseSchema',
    'databaseTable','databaseKey']){
    assert.equal(typeof copy[key],'string',key);
    assert.ok(copy[key].length>1,key);
    assert.doesNotMatch(copy[key],/uiExtra\.|Scope data|Registry|payload/iu,key);
  }
  assert.match(copy.groupLocSubject,/使用者識別碼/u);
});

test('Chinese sections do not display internal transport or raw data terminology',()=>{
  const keys=[
    ['uiExtra.importUI',['scopeUnresolved','refreshLoaded','refreshCompareFailed',
      'refreshAnalyzeFailed','refreshComplete','refreshWriteFailed','applyRefresh',
      'preview','mediaHelp','duplicateHelp']],
    ['uiExtra.feature',['registryLoading','registryUnavailable','registryNotFound']],
    ['uiExtra.statisticsUI',['loadingKeywordAttrs']],
    ['uiExtra.publisher',['scopeUnavailable']],
    ['uiExtra.keywords',['settingsGuide']],
    ['uiExtra.globalSettings',['mcpSelfServiceIntro','featureLoading']],
  ];
  for(const [file,items] of keys){
    const copy=dictionary(file);
    for(const key of items){
      assert.equal(typeof copy[key],'string',file+'.'+key);
      assert.doesNotMatch(copy[key],
        /Scope data|Scope Registry|Refresh payload|Source Refresh|Keywords Attr|vis-network|LOC Authority/iu,
        file+'.'+key);
    }
  }
});

test('User-facing errors omit raw SQL column/relation substitutions',()=>{
  const copy=dictionary('uiExtra.dataErrors');
  for(const key of ['columnNamed','columnUnknown','relationNamed','relationUnknown']){
    assert.doesNotMatch(copy[key],/\{(?:column|relation)\}|Schema|SQL|RPC/iu,key);
  }
});

test('Existing dynamic Group copy is independently localized, and actions stay unchanged',()=>{
  const group=read('app/loc/ScopeGroupAccessPanel.jsx');
  assert.match(group,/registerDefaultSection\('uiExtra\.scopeSettings',scopeSettingsZh\)/u);
  assert.match(group,/useUiSection\('uiExtra\.scopeSettings'\)/u);
  assert.match(group,/const ACTIONS=\['read','write','configure','manage'\]/u);
  assert.match(group,/groupAction.*charAt/u);
  assert.match(group,/群組關鍵字目錄/u);
  assert.doesNotMatch(group,/每筆記錄：Scope ID|四碼群組科目 UID|選擇公開的 Class UID/u);
});

test('Keyword public Class input accommodates native 8-char and legacy 4-char IDs',()=>{
  const panel=read('app/loc/KeywordLibraryPanel.jsx');
  assert.match(panel,/maxLength=\{8\}/u);
  assert.match(panel,/新版 8 碼、舊版 4 碼/u);
  assert.match(panel,/isUnifiedAnchorScope\(from\)\?\/\^\[0-9A-Za-z\]\{8\}\$\//u);
});

test('Chinese import progress preserves interpolation inputs',()=>{
  const copy=dictionary('uiExtra.importUI');
  for(const name of ['created','updated']){
    assert.ok(copy.refreshComplete.includes('{'+name+'}'),name);
  }
  for(const name of ['articles','chars','first','last']){
    assert.ok(dictionary('uiExtra.searchUI').summaryText.includes('{'+name+'}'),name);
  }
});
