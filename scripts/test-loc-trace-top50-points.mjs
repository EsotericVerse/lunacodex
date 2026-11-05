import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {locReferencedPointGroups,clusterLocSharedPoints} from '../app/modular/features/trace/trace-map-choices.mjs';

const points=Array.from({length:70},(_,i)=>'P'+String(i).padStart(7,'0'));
const entries=[
  {source_scope:'lo3rwang',trace_type:'path',uid:'R1234567',anchor_list:points},
  {source_scope:'lo3rwang',trace_type:'trace',uid:'T1234567',
    anchor_list:[points[3],'Q1234567'],route_list:{routes:['R1234567'],segments:[['Q1234567',points[4]]]}},
  {source_scope:'lrunes',trace_type:'path',uid:'R8765432',anchor_list:['A1234567','B1234567']},
  {source_scope:'lo3rwang',trace_type:'space_anchor',uid:'S1234567'}
];

test('LOC uses at most 50 distinct references per person, never independent points',()=>{
  const groups=locReferencedPointGroups(entries);
  assert.deepEqual(groups.map(g=>g.scope),['lo3rwang','lrunes']);
  assert.equal(groups[0].ids.length,50);
  assert.deepEqual(groups[0].ids,points.slice(0,50));
  assert.deepEqual(groups[1].ids,['A1234567','B1234567']);
  assert.ok(!groups.some(group=>group.ids.includes('S1234567')));
});

test('trace segment and linked path references count even without trace point list',()=>{
  const rows=[
    {source_scope:'lo3rwang',trace_type:'path',uid:'A1234567',anchor_list:['B1234567']},
    {source_scope:'lo3rwang',trace_type:'trace',uid:'C1234567',
      anchor_list:[],route_list:{routes:['A1234567'],segments:[['D1234567','E1234567']]}}
  ];
  assert.deepEqual(locReferencedPointGroups(rows)[0].ids,
    ['B1234567','D1234567','E1234567']);
});

test('LOC map never draws path or trace lines and performs only bounded point lookups',()=>{
  const s=readFileSync(new URL('../app/modular/features/Trace.jsx',import.meta.url),'utf8');
  assert.match(s,/locReferencedPointGroups\(allMaps,50\)/);
  assert.match(s,/readCurrentTraceAnchors\(group.scope,group.ids\)/);
  assert.match(s,/if\(isLoc\)return locPointsQuery\.data===undefined\?null:\{anchors:locSharedPoints,maps:\[\]\}/);
  assert.match(s,/clusterLocSharedPoints\(locPointsQuery\.data\|\|\[\],50\)/);
  assert.match(s,/selectedRouteUid=\{isLoc\?'':/);
  assert.match(s,/enabled:!isLoc&&supported&&routeListOpen/);
  assert.doesNotMatch(s,/readAllTraceAnchors\(/);
});

test('nearby points from different people become one dynamically labelled location',()=>{
  const points=[
    {uid:'A1234567',source_scope:'lo3rwang',title:'板橋車站',latitude:25.0143,longitude:121.4638,trace_type:'space_anchor'},
    {uid:'B1234567',source_scope:'lrunes',title:'板橋車站',latitude:25.0145,longitude:121.4639,trace_type:'space_anchor'},
    {uid:'C1234567',source_scope:'lrunes',title:'其他地點',latitude:25.0201,longitude:121.4700,trace_type:'space_anchor'}
  ];
  const result=clusterLocSharedPoints(points,50);
  assert.equal(result.length,2);
  assert.equal(result[0].member_count,2);
  assert.deepEqual(result[0].display_names,['lo3rwang:板橋車站','lrunes:板橋車站']);
  assert.equal(result[0].title,'lo3rwang:板橋車站 / lrunes:板橋車站');
  assert.equal(result[1].member_count,1);
  assert.equal(points[0].title,'板橋車站','source objects remain unchanged');
});

test('LOC caps shared positions globally at 50 and shares the limit across people',()=>{
  const points=[
    ...Array.from({length:60},(_,i)=>({uid:'A'+String(i).padStart(7,'0'),source_scope:'lo3rwang',
      title:'甲'+i,latitude:23+i*.02,longitude:121})),
    ...Array.from({length:60},(_,i)=>({uid:'B'+String(i).padStart(7,'0'),source_scope:'lrunes',
      title:'乙'+i,latitude:24+i*.02,longitude:122}))
  ];
  const result=clusterLocSharedPoints(points,50);
  assert.equal(result.length,50);
  assert.ok(result.some(row=>row.source_scope==='lo3rwang'));
  assert.ok(result.some(row=>row.source_scope==='lrunes'));
  assert.ok(result.every(row=>row.display_names.length>=1));
});
