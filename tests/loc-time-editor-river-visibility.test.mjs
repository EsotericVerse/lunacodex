import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildEraRiver} from '../app/loc/culture/time-trace-river.mjs';
import {resolveTimeSegments,resolveTimeTrace} from '../app/loc/culture/time-anchor-ranges.mjs';

const file=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const scope='lo3rwang';
const dates=[
  {uid:'DATE0001',scope_id:scope,type:'anchor',entry_type:'anchor',
   start_date:'2025-01-01',title:'年初定錨點'},
  {uid:'DATE0002',scope_id:scope,type:'anchor',entry_type:'anchor',
   start_date:'2025-06-01',title:'六月定錨點'}
];
const byDate=new Map(dates.map(row=>[row.uid,{...row,attr:{date:row.start_date}}]));
const periodRanges=resolveTimeSegments(['DATE0001','DATE0002'],byDate);
const period={uid:'PERI0001',scope_id:scope,type:'period',entry_type:'period',
  title:'第一時期',anchor_ids:['DATE0001','DATE0002'],ranges:periodRanges,
  start_date:periodRanges[0].start_date,end_date:periodRanges[0].end_date};
const eraRanges=resolveTimeTrace(['PERI0001'],new Map([['PERI0001',period]])).ranges;
const era={uid:'ERA00001',scope_id:scope,type:'era',entry_type:'era',
  title:'第一時代',anchor_ids:['PERI0001'],ranges:eraRanges,
  start_date:eraRanges[0].start_date,end_date:eraRanges[0].end_date};

test('management Time river paints Era while its Period and Date children remain collapsed',()=>{
  const model=buildEraRiver([...dates,period,era],[],{editorOnly:true,scopeId:scope});
  assert.equal(model.groups[0].label,'第一時代');
  assert.equal(model.groups[0].collapsible,true);
  assert.equal(model.items[0].entry_type,'era');
  assert.deepEqual([model.items[0].start_date,model.items[0].end_date],
    ['2025-01-01','2025-06-01']);
});
test('management expands Era -> Period -> dated anchors using the existing snapshot',()=>{
  const eraId='trace:lo3rwang:ERA00001';
  const periodId=eraId+':period:PERI0001';
  const model=buildEraRiver([...dates,period,era],[eraId,periodId],{
    editorOnly:true,scopeId:scope
  });
  assert.deepEqual(model.groups.map(row=>row.label),[
    '第一時代','期間｜第一時期','定錨點','未歸屬定錨點'
  ]);
  assert.deepEqual(model.items.map(row=>row.entry_type),[
    'era','period','anchor','anchor'
  ]);
});
test('Time management detects visibly blank vis charts and keeps interactive fallback',()=>{
  const timeline=file('app/modular/modules/culture-timeline/CultureTimeline.jsx');
  const view=file('app/modular/features/Culture.jsx');
  assert.match(timeline,/if\(mode!=='trace'\|\|!ready\|\|!rows\.length\|\|!extraGroups\.length\)return/);
  assert.match(timeline,/hasVisible\('\.vis-panel\.vis-left \.vis-label'\)/);
  assert.match(timeline,/hasVisible\('\.vis-panel\.vis-center \.vis-item'\)/);
  assert.match(timeline,/chartError&&mode==='trace'\?<TimeAnchorRecovery/);
  assert.match(timeline,/onToggle=\{groupId=>onGroupToggleRef\.current\?\.\(groupId\)\}/);
  assert.match(view,/scope-time-edit-workspace scope-culture-structure-river/);
  assert.match(view,/items=\{editorEraRiver\.items\}/);
  assert.match(view,/timeRecords=\{query\.data\?\.editorRows\|\|null\}/);
});

test('TimeAnchor management paints chart before the heavy list without a covering curtain',()=>{
  const chart=file('app/modular/modules/culture-timeline/CultureTimeline.jsx');
  const manage=file('app/modular/features/Culture.jsx');
  assert.match(chart,/unfoldCurtain=true/);
  assert.match(chart,/unfoldCurtain&&ready&&!reduceMotion/);
  assert.match(chart,/onFirstPaintRef\.current\?\.\(\)/);
  assert.match(manage,/unfoldCurtain=\{false\}/);
  assert.match(manage,/onFirstPaint=\{\(\)=>setTimeRiverFirstPaint\(true\)\}/);
  assert.match(manage,/!query\.isPending&&\(timeRiverFirstPaint\|\|!editorEraRiver\.groups\.length\)/);
  assert.match(manage,/setTimeout\(\(\)=>setTimeRiverFirstPaint\(true\),2000\)/);
});
