import test from 'node:test';
import assert from 'node:assert/strict';
import {cultureEraPeriodHierarchy} from '../app/loc/culture/era-period-hierarchy.mjs';
import {traceRouteHierarchy} from '../app/modular/features/trace/trace-route-hierarchy.mjs';
const scope='lo3rwang';
test('Culture Era -> Period links use only explicit era anchor_ids',()=>{
  const era={uid:'AAAA0001',scope_id:scope,anchor_ids:['BBBB0002','BBBB0002']};
  const rows=[{uid:'BBBB0002',scope_id:scope,entry_type:'period',title:'First'},
    {uid:'CCCC0003',scope_id:scope,entry_type:'period',title:'Not linked'}];
  const tree=cultureEraPeriodHierarchy([era],rows,scope);
  assert.deepEqual(tree.groups[0].periods.map(x=>x.uid),['BBBB0002']);
  assert.deepEqual(tree.unassigned.map(x=>x.uid),['CCCC0003']);
});
test('Trace -> Path links use only exact trace.route_list.routes',()=>{
  const row=(uid,type,child=[])=>({uid,trace_type:type,source_scope:scope,
    route_list:{routes:child}});
  const t=traceRouteHierarchy([
    row('AAAA0001','trace',['BBBB0002']),
    row('BBBB0002','path'),row('CCCC0003','path')
  ],scope);
  assert.deepEqual(t.groups.map(x=>x.trace.uid),['AAAA0001']);
  assert.deepEqual(t.groups[0].paths.map(x=>x.uid),['BBBB0002']);
  assert.deepEqual(t.orphans.map(x=>x.uid),['CCCC0003']);
});
test('Trace never attaches a different Scope Path by matching UID',()=>{
  const t=traceRouteHierarchy([
    {uid:'AAAA0001',trace_type:'trace',source_scope:scope,
      route_list:{routes:['BBBB0002']}},
    {uid:'BBBB0002',trace_type:'path',source_scope:'lrunes'}
  ],scope);
  assert.deepEqual(t.groups[0].paths,[]);
});
