import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {publicTraceMapChoices} from '../app/modular/features/trace/trace-map-choices.mjs';

const fixture=[
  {uid:'A001',source_scope:'lo3rwang',trace_type:'space_anchor'},
  {uid:'R001',source_scope:'lo3rwang',trace_type:'path',anchor_list:['A001','A002']},
  {uid:'T001',source_scope:'lo3rwang',trace_type:'trace',
    route_list:{routes:['R001'],segments:[['A002','A003']]},anchor_list:['A002','A003']},
  {uid:'R001',source_scope:'lrunes',trace_type:'path',anchor_list:['B001','B002']},
  {uid:'X001',source_scope:'lrunes',trace_type:'space_anchor'}
];

test('LOC loads each saved path as its own lightweight choice; union stays opt-in',()=>{
  const choices=publicTraceMapChoices(fixture,'loc');
  assert.deepEqual(choices.map(row=>row.source_scope+':'+row.uid),[
    'lo3rwang:R001','lrunes:R001','lo3rwang:LOC_UNION','lrunes:LOC_UNION'
  ]);
  assert.ok(choices.slice(0,2).every(row=>row.trace_type==='path'));
  assert.ok(choices.slice(2).every(row=>row.trace_type==='trace'&&row.read_only));
  assert.deepEqual(choices[2].route_list.routes,['R001']);
  assert.deepEqual(choices[2].route_list.segments,[['A002','A003']]);
});

test('a saved path is selectable without generating its combined union first',()=>{
  const rows=publicTraceMapChoices(fixture.filter(row=>row.trace_type!=='trace'),'loc');
  assert.equal(rows[0].uid,'R001');
  assert.equal(rows[1].uid,'R001');
  assert.deepEqual(publicTraceMapChoices([], 'loc'),[]);
});

test('individual scopes retain their actual saved route and trace choices',()=>{
  assert.deepEqual(publicTraceMapChoices(fixture,'lo3rwang').map(row=>row.uid),['R001','T001']);
  assert.deepEqual(publicTraceMapChoices(fixture,'lrunes').map(row=>row.uid),['R001']);
});

test('LOC home defaults to one path and selects union only by explicit value',()=>{
  const source=readFileSync(new URL('../app/modular/features/Trace.jsx',import.meta.url),'utf8');
  assert.match(source,/const maps=allMapChoices/);
  assert.match(source,/maps\.find\(row=>row\.trace_type==='path'\)\|\|null/);
  assert.match(source,/readCurrentTraceAnchors\(periodScopeId,members,/);
  assert.doesNotMatch(source,/readAllTraceAnchors\(/);
  assert.match(source,/selectedRouteUid=\{twoPointDemo\?/);
});
