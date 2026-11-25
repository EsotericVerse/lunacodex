import test from 'node:test';
import assert from 'node:assert/strict';
import {spaceRecordHierarchy} from '../app/loc/trace/space-record-hierarchy.mjs';

const scope='lo3rwang';
const point=(uid)=>({uid,title:uid,source_scope:scope,trace_type:'space_anchor'});
const path=(uid,items)=>({uid,title:uid,source_scope:scope,trace_type:'path',
  anchor_list:items,route_list:{routes:[]}});
const trace=(uid,routes,items=[])=>({uid,title:uid,source_scope:scope,
  trace_type:'trace',anchor_list:items,route_list:{routes,segments:[]}});

test('Scope boundary and invalid references cannot connect spatial branches',()=>{
  const spatial={anchors:[point('POINT001'),{
    ...point('POINT002'),source_scope:'other_scope'}],
    maps:[trace('TRACE001',['PATH0001']),{
      ...path('PATH0001',['POINT002']),source_scope:'other_scope'}]};
  const tree=spaceRecordHierarchy(spatial,scope);
  assert.deepEqual(tree.traces[0].paths,[]);
  assert.deepEqual(tree.unclassifiedPoints.map(x=>x.uid),['POINT001']);
});

