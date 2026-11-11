import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {annualGaugeGroups,annualGaugeValues} from '../app/modular/features/trace/trace-annual-gauges.mjs';

test('annual gauge counts distinct article days rather than number of visits or articles',()=>{
  const pins=[{uid:'AbCd1234',source_scope:'lo3rwang',title:'台北'}];
  const groups=annualGaugeGroups(pins,['lo3rwang','lrunes']);
  assert.deepEqual(groups,[{scope:'lo3rwang',ids:['AbCd1234']}]);
  const rows=[
    {source_scope:'lo3rwang',category:'AbCd1234',day:'2026-01-01',item_count:3},
    {source_scope:'lo3rwang',category:'AbCd1234',day:'2026-01-02',item_count:2},
    {source_scope:'lo3rwang',category:'AbCd1234',day:'2025-12-31',item_count:9}
  ];
  assert.deepEqual(annualGaugeValues(pins,groups,rows,'2026-01-01','2026-01-10'),[
    {uid:'AbCd1234',source_scope:'lo3rwang',percent:20,days:2,articles:5,span:10}
  ]);
});

test('cross-Scope pins combine available article days but never invent missing coverage',()=>{
  const pins=[{uid:'Aaaa1111',source_scope:'lo3rwang',
    members:[{uid:'Aaaa1111',source_scope:'lo3rwang'},{uid:'Bbbb2222',source_scope:'lrunes'}]}];
  const groups=annualGaugeGroups(pins,['lo3rwang','lrunes']);
  const rows=[
    {source_scope:'lo3rwang',category:'Aaaa1111',day:'2026-02-01',item_count:1},
    {source_scope:'lrunes',category:'Bbbb2222',day:'2026-02-01',item_count:2},
    {source_scope:'lrunes',category:'Bbbb2222',day:'2026-02-02',item_count:1}
  ];
  assert.deepEqual(annualGaugeValues(pins,groups,rows,'2026-02-01','2026-02-10'),[
    {uid:'Aaaa1111',source_scope:'lo3rwang',percent:20,days:2,articles:4,span:10}
  ]);
  assert.deepEqual(annualGaugeValues(pins,groups.slice(0,1),rows,'2026-02-01','2026-02-10'),[]);
});

test('untrusted and over-limit identifiers do not expand map queries',()=>{
  const pins=[{uid:'Aaaa1111',source_scope:'lo3rwang'},
    {uid:'Bbbb2222',source_scope:'lo3rwang'},
    {uid:'anything',source_scope:'bad'}];
  assert.deepEqual(annualGaugeGroups(pins,['lo3rwang'],1),[
    {scope:'lo3rwang',ids:['Aaaa1111']}
  ]);
});

test('annual summary does not query at overview zoom and keeps the map lifecycle',()=>{
  const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
  const publicTrace=read('app/modular/features/Trace.jsx');
  const map=read('app/modular/features/trace/TraceMap.jsx');
  const engine=read('app/modular/features/trace/trace-map-engine.js');
  assert.match(publicTrace,/enabled:annualGaugeOn&&annualGaugeDetailVisible&&annualGroups.length>0/);
  assert.match(publicTrace,/onAnnualGaugeVisibleChange=\{setAnnualGaugeDetailVisible\}/);
  assert.match(map,/onGaugeVisibilityChange:visible=>/);
  assert.match(engine,/onGaugeVisibilityChange\(gaugeDetailVisible\)/);
  assert.match(engine,/map\.on\('zoomend'/);
  assert.match(engine,/onGaugeVisibilityChange\(next\)/);
});
