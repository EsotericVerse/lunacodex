import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spaceRecordHierarchy} from '../app/loc/trace/space-record-hierarchy.mjs';

const scope='lo3rwang';
const point=(uid)=>({uid,title:uid,source_scope:scope,trace_type:'space_anchor'});
const path=(uid,items)=>({uid,title:uid,source_scope:scope,trace_type:'path',
  anchor_list:items,route_list:{routes:[]}});
const trace=(uid,routes,items=[])=>({uid,title:uid,source_scope:scope,
  trace_type:'trace',anchor_list:items,route_list:{routes,segments:[]}});

test('Spatial browser shows saved Trace -> Path -> Point links without inventing edges',()=>{
  const spatial={anchors:[point('POINT001'),point('POINT002'),point('POINT003')],
    maps:[trace('TRACE001',['PATH0001']),path('PATH0001',['POINT002','POINT001']),
      path('PATH0002',['POINT003'])]};
  const tree=spaceRecordHierarchy(spatial,scope);
  assert.deepEqual(tree.traces.map(x=>x.row.uid),['TRACE001']);
  assert.deepEqual(tree.traces[0].paths.map(x=>x.row.uid),['PATH0001']);
  assert.deepEqual(tree.traces[0].paths[0].points.map(x=>x.uid),['POINT002','POINT001']);
  assert.deepEqual(tree.unclassifiedPaths.map(x=>x.row.uid),['PATH0002']);
  assert.deepEqual(tree.unclassifiedPoints,[]);
});

test('Standalone Point and direct Trace segments remain visible',()=>{
  const spatial={anchors:[point('POINT001'),point('POINT002'),point('POINT003')],
    maps:[trace('TRACE001',[],['POINT001','POINT002'])]};
  const tree=spaceRecordHierarchy(spatial,scope);
  assert.deepEqual(tree.traces[0].directPoints.map(x=>x.uid),['POINT001','POINT002']);
  assert.deepEqual(tree.unclassifiedPoints.map(x=>x.uid),['POINT003']);
});

test('Shared Paths and Points may appear in multiple branches without false orphans',()=>{
  const spatial={anchors:[point('POINT001'),point('POINT002')],
    maps:[trace('TRACE001',['PATH0001']),trace('TRACE002',['PATH0001']),
      path('PATH0001',['POINT001'])]};
  const tree=spaceRecordHierarchy(spatial,scope);
  assert.equal(tree.traces[0].paths[0].points[0].uid,'POINT001');
  assert.equal(tree.traces[1].paths[0].points[0].uid,'POINT001');
  assert.deepEqual(tree.unclassifiedPaths,[]);
  assert.deepEqual(tree.unclassifiedPoints.map(x=>x.uid),['POINT002']);
});

test('Scope boundary and invalid references cannot connect spatial branches',()=>{
  const spatial={anchors:[point('POINT001'),{
    ...point('POINT002'),source_scope:'lrunes'}],
    maps:[trace('TRACE001',['PATH0001']),{
      ...path('PATH0001',['POINT002']),source_scope:'lrunes'}]};
  const tree=spaceRecordHierarchy(spatial,scope);
  assert.deepEqual(tree.traces[0].paths,[]);
  assert.deepEqual(tree.unclassifiedPoints.map(x=>x.uid),['POINT001']);
});

test('Management has one spatial browser, place organization and Timeline matching',()=>{
  const load=path=>readFileSync(new URL(path,import.meta.url),'utf8');
  const menu=load('../app/loc/trace/PlaceManagement.jsx');
  const scopeView=load('../app/loc/scope/ScopeManagement.jsx');
  const tree=load('../app/loc/trace/SpaceAnchorTree.jsx');
  const quick=load('../app/loc/trace/PlaceBatchFill.jsx');
  assert.match(menu,/value:'organize',label:'地點整理'/);
  assert.match(menu,/value:'timeline',label:'地點對照'/);
  assert.match(scopeView,/<UnifiedSpatialManagement scopeId=/);
  assert.match(tree,/aria-label="空間定錨階層列表"/);
  assert.match(tree,/aria-expanded=\{expanded\}/);
  assert.doesNotMatch(quick,/\.anchor\(scopeId,'point',\{op:'suggestions'/);
  assert.match(quick,/enabled:Boolean\(scope\?\.anchor\)/);
});
