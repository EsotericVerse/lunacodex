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
  assert.match(gate,/get_my_scope_management/);
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
  assert.match(parent,/<ManagementSearchWorkspace managementMode\/>/);
  // An embedded search must never create its own FeaturePage when the personal
  // management toggle is off, authentication is pending, or Scope is aggregate.
  assert.match(search,/if\(legacyManagementRoute\)return pageContent;/);
  assert.match(search,/return legacyManagementRoute\?overview:<FeaturePage featureId="search">\{overview\}<\/FeaturePage>;/);
  assert.doesNotMatch(search,/if\(managementMode\)return legacyManagementRoute\?/);
});
