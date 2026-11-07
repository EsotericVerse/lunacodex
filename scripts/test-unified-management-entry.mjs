import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {managementHeroSlot} from '../app/loc/home-block-model.js';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('five management routes exist for each standalone scope',()=>{
  for(const scope of ['lo3rwang','lrunes','scope-shell']){
    const base='app/'+scope+'/';
    assert.match(read(base+'manage/page.jsx'),/forcedView="manage"/);
    for(const [route,view] of [['culture','culture'],['statics','keywords'],['trace','manage'],['search','searchManage']])
      assert.match(read(base+route+'/manage/page.jsx'),new RegExp('forcedView="'+view+'"'));
  }
  assert.match(read('app/search/manage/page.jsx'),/forcedScope="loc"/);
});
test('one editor gate preserves distinct group and scope permissions',()=>{
  const gate=read('app/loc/ManagementAccess.jsx'),app=read('app/loc/LocApp.jsx');
  assert.match(gate,/grants\?\.canManageGlobalSync/);
  assert.match(gate,/grants\?\.canManageGroupSync\(id\)/);
  assert.match(gate,/grants\?\.canManageScopeSync\(id\)/);
  assert.match(gate,/editorSessionStatus\(window\.sessionStorage\)\.expired/);
  assert.doesNotMatch(gate,/get_my_scope_management/);
  assert.match(app,/scopeMeta\?\.aggregateChildren\?'group':'scope'/);
});
test('management heroes map to the correct copy slot',()=>{
  const pages=[
    ['/lo3rwang/manage','lo3rwang','manage','SpaceAnchor'],
    ['/lo3rwang/culture/manage','lo3rwang','culture','TimeAnchor'],
    ['/lo3rwang/statics/manage','lo3rwang','statics','ScopeKeyword'],
    ['/lo3rwang/trace/manage','lo3rwang','trace','SpaceAnchor'],
    ['/lo3rwang/search/manage','lo3rwang','search','ScopeAdvSearch'],
    ['/culture/manage','loc','culture','GalaxyManage'],
    ['/statics/manage','loc','statics','Groupkeyword'],
    ['/trace/manage','loc','trace','GroupSpace'],
    ['/search/manage','loc','search','GroupArticle']
  ];
  for(const [url,scope,feature,expected] of pages)
    assert.equal(managementHeroSlot(url,scope,true,feature)?.page,expected,url);
});

test('embedded article management keeps one Hero with or without list opt-in',()=>{
  const parent=read('app/loc/SearchManagement.jsx');
  const search=read('app/modular/features/Search.jsx');
  assert.match(parent,/return <FeaturePage featureId="search">/);
  assert.match(parent,/\{value:'publish',label:'文章管理',shortLabel:'文章管理'\}/);
  assert.match(parent,/search:'publish',media:'publish'/);
  assert.match(parent,/useManagementSection\(options,isLocAdmin\?'media':'publish'/);
  assert.match(parent,/const OLD_LOC_SECTION_ALIASES=Object\.freeze\(\{search:'media'\}\)/);
  assert.doesNotMatch(parent,/ManagementSearchWorkspace|value:'search',label:'管理搜尋'/);
  assert.match(parent,/\{value:'media',label:'發表多媒體',shortLabel:'媒體'\}/);
  assert.match(parent,/\{value:'trace',label:'治理原則',shortLabel:'治理原則'\}/);
  assert.doesNotMatch(parent,/ARTICLE_CONTROL_SECTIONS=Object\.freeze\(\[\s*\{value:'search'/);
  // An embedded search must never create its own FeaturePage when the personal
  // management toggle is off, authentication is pending, or Scope is aggregate.
  assert.match(search,/if\(legacyManagementRoute\)return pageContent;/);
  assert.match(search,/return legacyManagementRoute\?overview:<FeaturePage featureId="search">\{overview\}<\/FeaturePage>;/);
  assert.doesNotMatch(search,/if\(managementMode\)return legacyManagementRoute\?/);
  const shell=read('app/AppShell.jsx');
  assert.match(shell,/\{id:'suggestions',icon:'search',label:translateUiField\(activeLocale,'文章管理'\)/);
  assert.match(shell,/editTabHref\('search\/manage','section','media'\)/);
  assert.match(shell,/editTabHref\('search\/manage','section','publish'\)/);
  assert.doesNotMatch(shell,/editTabHref\('search\/manage','section','search'\)/);
});

test('Scope settings and Group authorization are hosted by Article Management',()=>{
  const article=read('app/loc/SearchManagement.jsx');
  const spatial=read('app/loc/ScopeManagement.jsx');
  assert.match(article,/\{value:'settings',label:'主題／資料庫',shortLabel:'設定'\}/);
  assert.match(article,/\{value:'groupAccess',label:'群組權限',shortLabel:'授權'\}/);
  assert.match(article,/activeSection==='settings'/);
  assert.match(article,/activeSection==='groupAccess'/);
  assert.match(article,/account\.canManageGroupSync\(scopeId\)/);
  assert.doesNotMatch(spatial,/<ScopeSettingsPanel|<ScopeGroupAccessPanel/);
  assert.match(spatial,/\['settings','groupAccess','import','others'\]/);
});

test('LOC Group edit dock has system, keywords, people, articles in that order',()=>{
  const shell=read('app/AppShell.jsx');
  const groupDock=shell.split('const editDestinations=locAdminEdit?[')[1]?.split(']:[')[0]||'';
  assert.deepEqual([...groupDock.matchAll(/\{id:'([^']+)',icon:/g)].map(match=>match[1]),
    ['system','keywords','members','suggestions']);
  assert.match(groupDock,/href:'\/admin\/'/);
  assert.match(groupDock,/label:translateUiField\(activeLocale,'系統管理'\)/);
  assert.match(groupDock,/label:translateUiField\(activeLocale,'人員作品管理'\)/);
  assert.doesNotMatch(groupDock,/痕跡圖管理|traceMap/);
  assert.doesNotMatch(shell,/className="scope-nav-admin"/);
});

test('Shared six-button edit dock keeps Save at left and Discard at right',()=>{
  const shell=read('app/AppShell.jsx');
  const css=read('app/styles/bottom-navigation.css');
  assert.match(shell,/const editTabs=\[\s*\{id:'save'/);
  assert.match(shell,/\.\.\.editDestinations,\s*\{id:'cancel'/);
  assert.match(shell,/editingDockVisible\?editTabs\.map\(tab=>tab\.action/);
  assert.match(shell,/<div className="scope-feature-dock scope-floating-edit-buttons" role="toolbar"/);
  assert.doesNotMatch(shell,/<nav className="scope-feature-dock"/);
  assert.match(css,/\.scope-feature-dock\{[\s\S]*?background:transparent;[\s\S]*?box-shadow:none;/);
  assert.match(css,/\.scope-feature-dock a,\.scope-feature-dock button\{[\s\S]*?box-shadow:0 6px 18px/);
  assert.doesNotMatch(shell,/editTabs\.filter\(/);
  assert.match(css,/grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
  assert.doesNotMatch(css,/scope-feature-dock__groups|scope-feature-dock__navigation|scope-feature-dock__actions/);
});

test('management navigation reuses verified role; expired editor forces fresh check',()=>{
  const gate=read('app/loc/ManagementAccess.jsx');
  const account=read('app/loc/use-account.js');
  assert.match(gate,/readVerifiedManagementEntry\(\)\|\|account\.refresh\(\)/);
  assert.match(gate,/editorSessionStatus\(window\.sessionStorage\)\.expired\s*\?account\.refresh\(\)/);
  assert.match(account,/grant\.userId!==authUserId\|\|grant\.email!==authEmail/);
  assert.match(account,/clearAuthorization\(\)/);
});

test('Group authorization registers its own UI locale independent of Settings tab',()=>{
  const group=read('app/loc/ScopeGroupAccessPanel.jsx');
  const settings=read('app/loc/ScopeSettingsPanel.jsx');
  assert.match(settings,/registerDefaultSection\('uiExtra\.scopeSettings',scopeSettingsZh\)/);
  assert.match(group,/registerDefaultSection\('uiExtra\.scopeSettings',scopeSettingsZh\)/);
  assert.match(group,/useUiSection\('uiExtra\.scopeSettings'\)/);
  assert.match(group,/groupAction.*charAt/);
  assert.match(group,/grant\.actions\.map\(actionLabel\)/);
  for(const locale of ['zh_tw','zh_cn','en','ja']){
    const dictionary=read('app/i18n/sections/uiExtra.scopeSettings.'+locale+'.js');
    for(const key of ['groupTitle','groupIntro','groupMemberScope','groupLocSubject',
      'groupExpires','groupPermissions','groupGrant','groupCurrentGrants',
      'groupNoGrants','groupActionRead','groupActionWrite','groupActionConfigure',
      'groupActionManage']){
      assert.match(dictionary,new RegExp('"'+key+'"\\s*:'),locale+' lacks '+key);
    }
  }
});


test('nine management screens share the same theme-driven responsive frame',()=>{
  const frame=read('app/loc/ManagementWorkspaceFrame.jsx');
  const css=read('app/styles/settings-select.css');
  const sources={
    time:read('app/modular/features/Culture.jsx'),
    keyword:read('app/modular/features/KeywordSettings.jsx'),
    place:read('app/loc/ScopeManagement.jsx'),
    article:read('app/loc/SearchManagement.jsx'),
    groupPeople:read('app/loc/LocSourceManagement.jsx'),
    groupKeyword:read('app/loc/LocManagementWorkspace.jsx'),
    admin:read('app/loc/views/AdminHomeView.jsx')
  };
  const screens=[
    ['Scope / 時間',sources.time,/ManagementWorkspaceFrame level="scope" title="時間定錨管理"/],
    ['Scope / 關鍵詞',sources.keyword,/ManagementWorkspaceFrame level="scope" title="關鍵詞管理"/],
    ['Scope / 空間',sources.place,/ManagementWorkspaceFrame level=\{isLoc\?'group':'scope'\}/],
    ['Scope / 文章',sources.article,/ManagementWorkspaceFrame level=\{isLocAdmin\?'group':'scope'\}/],
    ['Scope Group / 人員作品',sources.groupPeople,/ManagementWorkspaceFrame level="group" title="人員作品管理"/],
    ['Scope Group / 關鍵詞',sources.groupKeyword,/ManagementWorkspaceFrame level="group" title=\{item.label\}/],
    ['Scope Group / 痕跡',sources.place,/title=\{traceOnly\?'痕跡圖管理':'空間定錨管理'\}/],
    ['Scope Group / 文章',sources.article,/level=\{isLocAdmin\?'group':'scope'\}/],
    ['Admin / 系統',sources.admin,/ManagementWorkspaceFrame level="admin" title="系統管理"/]
  ];
  assert.equal(screens.length,9);
  for(const [name,source,marker] of screens)assert.match(source,marker,name);
  for(const name of ['scope','group','admin'])assert.match(frame,new RegExp(name+':'));
  assert.match(frame,/data-management-level=\{resolved\}/);
  assert.match(frame,/management-workspace__heading/);
  assert.match(css,/\.management-workspace--unified\{/);
  assert.match(css,/grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css,/\.management-workspace--unified>.management-section-nav/);
  assert.match(css,/overflow-x:auto/);
  assert.match(css,/min-height:44px/);
  assert.match(css,/@media\(max-width:680px\)/);
  assert.match(css,/--loc-accent/);
  assert.match(css,/--loc-ui-panel/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(sources.article,/activeSection==='groupAccess'/);
  assert.match(sources.admin,/account\.canManageGlobalSync\(\)/);
  assert.match(sources.place,/editDock\.switchSection\(next,setSection\)/);
});


test('Unified management forms and homepage block editors show task-specific hierarchy',()=>{
  const css=read('app/styles/settings-select.css');
  const list=read('app/loc/ScopeBlockDraftList.jsx');
  const single=read('app/loc/ScopeBlockEditorSession.jsx');
  assert.match(css,/\.scope-editor-stage\{/);
  assert.match(css,/management-workspace--unified>\.management-workspace-panel/);
  for(const source of [list,single]){
    assert.match(source,/scope-editor-stage__title">文字內容/);
    assert.match(source,/scope-editor-stage__title">主視覺圖片/);
    assert.match(source,/scope-editor-stage__title">附屬內容/);
  }
});

test('Scope has its own source Anchor entry while LOC retains group-level management',()=>{
  const scope=read('app/loc/SearchManagement.jsx');
  const loc=read('app/loc/LocSourceManagement.jsx');
  assert.match(scope,/\{value:'source',label:'來源分類',shortLabel:'來源'\}/);
  assert.match(scope,/activeSection==='source'/);
  assert.match(scope,/<ScopeOthersSources key=\{scopeId\+'-sources'\} scopeId=\{scopeId\}\/>/);
  assert.doesNotMatch(scope,/source:'import'/);
  assert.match(loc,/<WorkClassificationPage\/>/);
  assert.doesNotMatch(loc,/ScopeOthersSources/);
});
