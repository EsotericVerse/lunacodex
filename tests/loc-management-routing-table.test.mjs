import test from 'node:test';
import assert from 'node:assert/strict';
import {managementRouteHref}
  from '../app/modular/routing/management-route-table.mjs';

// Deliberately use a tiny resolver fixture: the route table must not depend
// on UI locale JSON, React, or framework modules just to encode destinations.
const navigationFixture=(scope,path,native)=>{
  const prefix=scope==='loc'||scope==='lrunes'?'':scope==='lo3rwang'
    ?'/lo3rwang':'/scope-shell';
  const pathname=prefix+'/'+path.replace(/^\/+/, '')+'/';
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
    const link=href('group',slot,'loc');
    assert.doesNotMatch(link,/edit=1/);
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
