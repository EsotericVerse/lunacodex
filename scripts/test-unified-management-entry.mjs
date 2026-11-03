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

test('Shared six-button edit dock keeps Save at left and Discard at right',()=>{
  const shell=read('app/AppShell.jsx');
  const css=read('app/styles/bottom-navigation.css');
  assert.match(shell,/const editTabs=\[\s*\{id:'save'/);
  assert.match(shell,/\.\.\.editDestinations,\s*\{id:'cancel'/);
  assert.match(shell,/editingDockVisible\?editTabs\.map\(tab=>tab\.action/);
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
