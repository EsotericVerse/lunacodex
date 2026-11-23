import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildEraRiver} from '../app/loc/culture/time-trace-river.mjs';
import {resolveTimeSegments,resolveTimeTrace} from '../app/loc/culture/time-anchor-ranges.mjs';
import {timelinePainted} from '../app/modular/modules/culture-timeline/timeline-paint-health.mjs';

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
  assert.match(timeline,/if\(mode!=='trace'\|\|!ready\|\|!extraGroups\.length\|\|chartError\)return/);
  assert.match(timeline,/timelinePainted\(containerRef\.current\)/);
  assert.doesNotMatch(timeline,/!ready\|\|!rows\.length\|\|!extraGroups\.length/);
  assert.match(timeline,/showTraceRecovery\?<TimeAnchorRecovery/);
  assert.match(timeline,/const showTraceRecovery=mode==='trace'&&extraGroups\.length>0&&\(chartError\|\|!tracePainted\)/);
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
  assert.match(manage,/!query\.isPending&&!query\.error&&\(timeRiverFirstPaint\|\|timeEditorFrameReady\|\|!editorEraRiver\.groups\.length\)/);
  assert.match(manage,/window\.requestAnimationFrame/);
  assert.doesNotMatch(manage,/setTimeout\(\(\)=>setTimeRiverFirstPaint\(true\)/);
});

const rect=(left,top,width,height)=>({left,top,width,height,right:left+width,bottom:top+height});
function fakeTimeline({hidden=false,clipped=false,noBars=false}={}){
  const root={getBoundingClientRect:()=>rect(0,0,700,300)};
  const vis={parentElement:root,getBoundingClientRect:()=>rect(0,0,700,300)};
  const left={parentElement:vis,getBoundingClientRect:()=>rect(0,0,140,300)};
  const center={parentElement:vis,getBoundingClientRect:()=>rect(140,0,560,300)};
  const label={parentElement:left,getBoundingClientRect:()=>rect(0,25,140,35)};
  const item={parentElement:center,getBoundingClientRect:()=>rect(clipped?710:170,25,clipped?90:150,30)};
  root.querySelector=selector=>({
    '.vis-timeline':vis,'.vis-panel.vis-left':left,'.vis-panel.vis-center':center
  })[selector]||null;
  root.querySelectorAll=selector=>({
    '.vis-panel.vis-left .vis-label':[label],
    '.vis-panel.vis-center .vis-item':noBars?[]:[item]
  })[selector]||[];
  return {root,getStyle:node=>({display:'block',visibility:'visible',
    contentVisibility:'visible',opacity:hidden&&node===item?'0':'1'})};
}

test('Time river paint health requires visible labels and on-screen bars',()=>{
  let t=fakeTimeline();
  assert.equal(timelinePainted(t.root,t.getStyle),true);
  t=fakeTimeline({clipped:true});
  assert.equal(timelinePainted(t.root,t.getStyle),false);
  t=fakeTimeline({hidden:true});
  assert.equal(timelinePainted(t.root,t.getStyle),false);
  t=fakeTimeline({noBars:true});
  assert.equal(timelinePainted(t.root,t.getStyle),false);
});
test('Empty-but-linked Time tree is recovered instead of blocking its editor',()=>{
  const chart=file('app/modular/modules/culture-timeline/CultureTimeline.jsx');
  assert.match(chart,/!ready\|\|!extraGroups\.length\|\|chartError/);
  assert.match(chart,/setChartError\(true\)/);
  assert.match(chart,/chartError&&mode==='trace'\?<TimeAnchorRecovery/);
  const manage=file('app/modular/features/Culture.jsx');
  assert.match(manage,/onFirstPaint=\{\(\)=>setTimeRiverFirstPaint\(true\)\}/);
});

test('Time river is visible from loaded rows before the vis canvas is ready',()=>{
  const chart=file('app/modular/modules/culture-timeline/CultureTimeline.jsx');
  const css=file('app/styles/scope-system.css');
  assert.match(chart,/const \[tracePainted,setTracePainted\]=useState\(false\)/);
  assert.match(chart,/showTraceRecovery=mode==='trace'&&extraGroups\.length>0&&\(chartError\|\|!tracePainted\)/);
  assert.match(chart,/const recovery=containerRef\.current\?\.parentElement\?\.parentElement/);
  assert.match(chart,/recovery\?\.getBoundingClientRect\(\)\.height>2/);
  assert.match(css,/\.scope-trace-progressive-shell>\.scope-time-recovery-river/);
  assert.match(css,/position:relative;z-index:1/);
  assert.match(chart,/if\(timelinePainted\(containerRef\.current\)\)setTracePainted\(true\)/);
});

test('Time record transaction completion cannot wait forever for a vis onFirstPaint notification',()=>{
  const management=file('app/modular/features/Culture.jsx');
  assert.match(management,/const \[timeEditorFrameReady,setTimeEditorFrameReady\]=useState\(false\)/);
  assert.match(management,/setTimeEditorFrameReady\(true\)/);
  assert.match(management,/timeRiverFirstPaint\|\|timeEditorFrameReady\|\|!editorEraRiver\.groups\.length/);
  assert.doesNotMatch(management,/setTimeout\(\(\)=>setTimeRiverFirstPaint\(true\)/);
});
