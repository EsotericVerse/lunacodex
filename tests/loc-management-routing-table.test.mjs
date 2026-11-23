import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {LOC_MANAGEMENT_ROUTE_TABLE,managementRouteHref}
  from '../app/modular/routing/management-route-table.mjs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
// Deliberately use a tiny resolver fixture: the route table must not depend
// on UI locale JSON, React, or framework modules just to encode destinations.
const navigationFixture=(scope,path,native)=>{
  const prefix=scope==='loc'||scope==='lrunes'?'':scope==='lo3rwang'
    ?'/lo3rwang':'/scope-shell';
  const pathname=prefix+'/'+path.replace(/^\\/+/, '')+'/';
  if(native){
    const file=pathname+'index.html';
    return ['loc','lo3rwang','lrunes'].includes(scope)
      ?file:file+'?scopeid='+encodeURIComponent(scope);
  }
  const host=scope==='lrunes'?'lrunes.lo3rwang.cc':'loc.lo3rwang.cc';
  const url=new URL(pathname,'https://'+host);
  if(!['loc','lo3rwang','lrunes'].includes(scope))
    url.searchParams.set('scopeid',scope);
  return url.href;
};
const href=(level,key,scopeId='loc',native=false)=>managementRouteHref(
  level,key,scopeId,{native,navigate:navigationFixture}
);
const expected={
  group:{
    system:'/admin/',keywords:'/statics/manage/',members:'/manage/',
    articles:'/search/manage/?section=publish&edit=1'
  },
  scope:{
    time:'/culture/manage/',keywords:'/statics/manage/',
    spatial:'/trace/manage/?section=anchor',
    articles:'/search/manage/?section=publish'
  },
  user:{
    culture:'/culture/',statics:'/statics/',trace:'/trace/',search:'/search/'
  }
};

test('Group Scope User route table has precisely the requested slots and order',()=>{
  for(const level of Object.keys(expected)){
    assert.deepEqual(Object.keys(LOC_MANAGEMENT_ROUTE_TABLE[level]),
      Object.keys(expected[level]));
    for(const [key,want] of Object.entries(expected[level])){
      const result=href(level,key,'loc');
      if(level==='group'&&key==='system'){
        assert.equal(result,want);
      }else{
        const url=new URL(result);
        assert.equal(url.pathname+url.search,want,level+':'+key);
      }
    }
  }
});

test('Scope routes retain owner domain/directory and section without edit=1',()=>{
  const author=href('scope','spatial','lo3rwang');
  const url=new URL(author);
  assert.equal(url.pathname,'/lo3rwang/trace/manage/');
  assert.equal(url.searchParams.get('section'),'anchor');
  assert.equal(url.searchParams.has('edit'),false);
  const article=new URL(href('scope','articles','lrunes'));
  assert.equal(article.pathname,'/search/manage/');
  assert.equal(article.searchParams.get('section'),'publish');
  assert.equal(article.searchParams.has('edit'),false);
});

test('Group articles keep explicit edit=1; other Group destinations do not',()=>{
  const article=new URL(href('group','articles','loc'));
  assert.equal(article.searchParams.get('section'),'publish');
  assert.equal(article.searchParams.get('edit'),'1');
  for(const slot of ['system','keywords','members']){
    const href=href('group',slot,'loc');
    assert.doesNotMatch(href,/edit=1/);
  }
});

test('Native index.html files append query AFTER filename, including dynamic scopeid',()=>{
  assert.equal(href('scope','spatial','lo3rwang',true),
    '/lo3rwang/trace/manage/index.html?section=anchor');
  assert.equal(href('scope','articles','example',true),
    '/scope-shell/search/manage/index.html?scopeid=example&section=publish');
  assert.equal(href('group','articles','loc',true),
    '/search/manage/index.html?section=publish&edit=1');
  assert.equal(href('user','culture','lo3rwang',true),
    '/lo3rwang/culture/index.html');
});

test('Actual management pages mount their new editors, not stale route aliases',()=>{
  assert.match(read('app/manage/page.jsx'),/forcedView="sourceManage" forcedScope="loc"/);
  for(const scope of ['lo3rwang','lrunes']){
    const src=read('app/'+scope+'/trace/manage/page.jsx');
    assert.match(src,/forcedView="manage"/);
    assert.match(src,/forcedSection="anchor"/);
  }
  const dynamic=read('app/scope-shell/trace/manage/page.jsx');
  assert.match(dynamic,/forcedSection="anchor"/);
  const oldGroup=read('app/culture/manage/page.jsx');
  assert.match(oldGroup,/LegacyManagementRedirect target="group"/);
  for(const legacy of ['lo3rwang','lrunes','scope-shell']){
    const src=read('app/'+legacy+'/manage/page.jsx');
    assert.match(src,/LegacyManagementRedirect target="trace"/);
  }
});

test('Dock uses route table for all three tiers and preserves write boundary',()=>{
  const shell=read('app/AppShell.jsx');
  const scope=read('app/loc/scope/ScopeManagement.jsx');
  const legacy=read('app/loc/management/LegacyManagementRedirect.jsx');
  assert.match(shell,/managementHref\('group','members'\)/);
  assert.match(shell,/managementHref\('scope','spatial'\)/);
  assert.match(shell,/managementHref\('scope','articles'\)/);
  assert.match(shell,/managementRouteHref\('user',id/);
  assert.doesNotMatch(shell,/editTabHref\('manage','section','anchor'\)/);
  assert.match(scope,/url\.pathname\.replace\(/);
  assert.match(scope,/trace/);
  assert.match(legacy,/window\.location\.replace\(url\.href\)/);
  assert.match(legacy,/url\.searchParams\.set\('section','anchor'\)/);
  assert.match(read('app/loc/LocApp.jsx'),/level=\{managementLevel\}/);
});
