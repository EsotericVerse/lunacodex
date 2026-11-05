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
  assert.equal(result.length,1);
  assert.equal(result[0].member_count,2);
  assert.deepEqual(result[0].display_names,['lo3rwang:板橋車站','lrunes:板橋車站']);
  assert.equal(result[0].title,'lo3rwang:板橋車站 / lrunes:板橋車站');
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
  assert.equal(result.length,0,'no common coordinates across scopes means no LOC pins');
});

test('late member shared locations must be found before the final 50-pin limit',()=>{
  const first=Array.from({length:50},(_,i)=>({
    uid:'A'+String(i).padStart(7,'0'),source_scope:'scopeone',title:'單點'+i,
    latitude:20+i*.01,longitude:120
  }));
  const second=[
    {uid:'B1234567',source_scope:'scopetwo',title:'新共點',latitude:24,longitude:122},
    ...Array.from({length:49},(_,i)=>({
      uid:'B'+String(i).padStart(7,'0'),source_scope:'scopetwo',title:'其他'+i,
      latitude:26+i*.01,longitude:123
    }))
  ];
  const third=[{uid:'C1234567',source_scope:'scopethree',title:'新共點',
    latitude:24.0002,longitude:122.0002}];
  const result=clusterLocSharedPoints([...first,...second,...third],50);
  assert.equal(result.length,1);
  assert.equal(result[0].share_count,2,'only the cross-scope common point remains');
  assert.deepEqual(result[0].display_names,['scopetwo:新共點','scopethree:新共點']);
});

test('repeated places within only one Scope do not qualify as a shared intersection',()=>{
  const pins=clusterLocSharedPoints([
    {uid:'A1234567',source_scope:'lo3rwang',title:'板橋甲',latitude:25.0143,longitude:121.4638},
    {uid:'A7654321',source_scope:'lo3rwang',title:'板橋乙',latitude:25.0144,longitude:121.4639},
    {uid:'B1234567',source_scope:'lrunes',title:'台北其他地點',latitude:25.08,longitude:121.52}
  ]);
  assert.equal(pins.length,0);
});

test('when 60 common positions exist only first 50 appear, not unrelated points',()=>{
  const rows=[];
  for(let i=0;i<60;i++){
    const latitude=21+i*.05,longitude=121;
    rows.push({uid:'A'+String(i).padStart(7,'0'),source_scope:'lo3rwang',
      title:'共同'+i,latitude,longitude});
    rows.push({uid:'B'+String(i).padStart(7,'0'),source_scope:'lrunes',
      title:'共同'+i,latitude:latitude+.0001,longitude:longitude+.0001});
  }
  const result=clusterLocSharedPoints(rows,50);
  assert.equal(result.length,50);
  assert.ok(result.every(pin=>pin.share_count===2));
  assert.ok(result.every(pin=>pin.display_names.length===2));
});

test('only scopes with trace enabled are consulted for LOC route index',()=>{
  const code=readFileSync(new URL('../app/modular/features/trace/trace-data.js',import.meta.url),'utf8');
  assert.match(code,/selectScopeConfig\(id\)/);
  assert.match(code,/scopeFeatureEnabled\(config,'trace'\)/);
});
