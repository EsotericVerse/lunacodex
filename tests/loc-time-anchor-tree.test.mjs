import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {timeRecordHierarchy} from '../app/loc/culture/time-record-hierarchy-options.mjs';
import {buildEraRiver} from '../app/loc/culture/time-trace-river.mjs';
import {nextEditorEraExpansion} from '../app/loc/culture/time-trace-river.mjs';
import {resolveTimeSegments} from '../app/loc/culture/time-anchor-ranges.mjs';
import {resolveTimeTrace} from '../app/loc/culture/time-anchor-ranges.mjs';
import {timelinePainted} from '../app/modular/modules/culture-timeline/timeline-paint-health.mjs';
import {cultureEraPeriodHierarchy} from '../app/loc/culture/era-period-hierarchy.mjs';
import {traceRouteHierarchy} from '../app/modular/features/trace/trace-route-hierarchy.mjs';

{
const era=(uid,title,anchor_ids,attr={})=>({uid,title,type:'era',anchor_ids,attr});
const period=(uid,title,anchor_ids,attr={})=>({uid,title,type:'period',anchor_ids,attr});
const date=(uid,address)=>({uid,type:'anchor',title:address,address});

test('Era rows sort oldest-to-newest by their linked Period/Date, not input order',()=>{
  const rows=[
    era('LATER001','Later',['PERI0002']),
    period('PERI0002','Later period',['DATE0002']),
    date('DATE0002','2025-06-01'),
    era('EARLY001','Early',['PERI0001']),
    date('DATE0001','2010-04-02'),
    period('PERI0001','Early period',['DATE0001']),
    era('NODATE01','Undated',['MISSING1'])
  ];
  const tree=timeRecordHierarchy(rows);
  assert.deepEqual(tree.eras.map(group=>group.row.uid),['EARLY001','LATER001','NODATE01']);
  assert.deepEqual(tree.eras.map(group=>group.start),['2010-04-02','2025-06-01','9999-12-31']);
  assert.deepEqual(tree.eras[0].periods.map(branch=>branch.row.uid),['PERI0001']);
  assert.deepEqual(tree.eras[0].periods[0].dates.map(row=>row.uid),['DATE0001']);
});

test('Periods and Dates have their own chronological order even if saved links are reversed',()=>{
  const tree=timeRecordHierarchy([
    era('ERA00001','A',['PERI0002','PERI0001']),
    period('PERI0002','Later',['DATE0004','DATE0003']),
    period('PERI0001','Earlier',['DATE0002','DATE0001']),
    date('DATE0004','2020-12-01'),date('DATE0003','2020-01-01'),
    date('DATE0002','2002-07-01'),date('DATE0001','2001-05-01')
  ]);
  assert.deepEqual(tree.eras[0].periods.map(x=>x.row.uid),['PERI0001','PERI0002']);
  assert.deepEqual(tree.eras[0].periods[0].dates.map(x=>x.uid),['DATE0001','DATE0002']);
  assert.deepEqual(tree.eras[0].periods[1].dates.map(x=>x.uid),['DATE0003','DATE0004']);
});

test('Unlinked Period and Date stay in two separate unclassified groups',()=>{
  const tree=timeRecordHierarchy([
    era('ERA00001','A',['PERI0001']),
    period('PERI0001','Linked',['DATE0001']),
    date('DATE0001','2023-10-01'),
    period('PERI0003','Orphan 2022',['DATE0003']),
    period('PERI0002','Orphan 2020',['DATE0002']),
    date('DATE0003','2022-01-01'),
    date('DATE0002','2020-01-01'),
    date('DATE0000','1990-01-01')
  ]);
  assert.deepEqual(tree.unclassifiedPeriods.map(x=>x.row.uid),['PERI0002','PERI0003']);
  assert.deepEqual(tree.unclassifiedDates.map(x=>x.uid),['DATE0000']);
  assert.equal(tree.eras.length,1);
});

test('Shared Date/Period links are projected without falsely classifying them as orphan',()=>{
  const tree=timeRecordHierarchy([
    era('ERA00002','B',['PERI0001']),era('ERA00001','A',['PERI0001']),
    period('PERI0001','Shared',['DATE0001']),date('DATE0001','2020-01-01')
  ]);
  assert.equal(tree.eras.length,2);
  assert.equal(tree.eras[0].periods[0].dates[0].uid,'DATE0001');
  assert.deepEqual(tree.unclassifiedPeriods,[]);
  assert.deepEqual(tree.unclassifiedDates,[]);
});

test('Saved explicit range sorts Period when its Date endpoints are not present',()=>{
  const tree=timeRecordHierarchy([
    era('ERA00001','Old',['PERI0001']),
    period('PERI0001','Old period',[],{date:['1995-01-01','1995-12-31']}),
    era('ERA00002','New',['PERI0002']),
    period('PERI0002','New period',['DATE0002']),
    date('DATE0002','2005-01-01')
  ]);
  assert.deepEqual(tree.eras.map(x=>x.row.uid),['ERA00001','ERA00002']);
});
}

{
test('management Era lanes retain all dated anchors and unclassified dates',()=>{
  const scope='lo3rwang';
  const dates=[
    {uid:'AAAA0001',entry_type:'anchor',scope_id:scope,title:'Old',start_date:'2012-01-01'},
    {uid:'AAAA0002',entry_type:'anchor',scope_id:scope,title:'Recent',start_date:'2020-02-02'},
    {uid:'AAAA0003',entry_type:'anchor',scope_id:scope,title:'Outside',start_date:'2026-11-22'}
  ];
  const entries=[
    {uid:'ERAA0001',entry_type:'era',scope_id:scope,title:'First era',
      anchor_ids:['PERA0001'],
      ranges:[{start_date:'2010-01-01',end_date:'2023-12-31'}]},
    {uid:'PERA0001',entry_type:'period',scope_id:scope,title:'First period',
      ranges:[{start_date:'2010-01-01',end_date:'2023-12-31'}]},
    ...dates
  ];
  const group='trace:'+scope+':ERAA0001';
  const periodGroup=group+':period:PERA0001';
  const unassigned='time-undefined:'+scope;
  const collapsed=buildEraRiver(entries,[],{editorOnly:true,scopeId:scope});
  assert.deepEqual(collapsed.groups.map(row=>row.id),[group,unassigned]);
  assert.equal(collapsed.items.filter(item=>item.entry_type==='anchor').length,0,
    'collapsed Era and unassigned lane must not render every Date');
  const eraOpen=buildEraRiver(entries,[group],{editorOnly:true,scopeId:scope});
  assert.ok(eraOpen.groups.some(item=>item.id===periodGroup));
  assert.equal(eraOpen.items.filter(item=>item.entry_type==='anchor').length,0,
    'collapsed Period must not render its Date children');
  const periodOpen=buildEraRiver(entries,[group,periodGroup],{editorOnly:true,scopeId:scope});
  assert.deepEqual(periodOpen.items.filter(item=>item.entry_type==='anchor')
    .map(item=>item.uid).sort(),['AAAA0001','AAAA0002']);
  assert.ok(periodOpen.groups.find(item=>item.id===periodGroup+':dates').order
    <periodOpen.groups.find(item=>item.id===unassigned).order);
  const unrelated=buildEraRiver(entries,[unassigned],{editorOnly:true,scopeId:scope});
  assert.equal(unrelated.items.find(item=>item.uid==='AAAA0003').group_key,unassigned);
});
}

{
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
    '第一時代','期間｜第一時期','定錨點','未定義定錨'
  ]);
  assert.deepEqual(model.items.map(row=>row.entry_type),[
    'era','period','anchor','anchor'
  ]);
});
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
test('TimeAnchor begins with chronological Era entries only, without eager Periods/Dates',()=>{
  const latest={...era,uid:'ERA00002',title:'較晚時代',start_date:'2028-01-01',
    end_date:'2028-12-31',ranges:[{start_date:'2028-01-01',end_date:'2028-12-31',
      invalid:false}],anchor_ids:[]};
  const initial=buildEraRiver([latest,...dates,period,era],[],{
    editorOnly:true,scopeId:scope
  });
  assert.deepEqual(initial.groups.map(group=>group.label),['第一時代','較晚時代','未定義定錨']);
  assert.deepEqual(initial.items.map(item=>item.entry_type),['era','era']);
  assert.equal(initial.groups.every(group=>group.depth===undefined),true);
});

test('TimeAnchor keeps one Era and one Period open, and closes siblings',()=>{
  const e1='trace:lo3rwang:ERA00001',e2='trace:lo3rwang:ERA00002';
  const p1=e1+':period:PERI0001',p2=e2+':period:PERI0002';
  assert.deepEqual(nextEditorEraExpansion([],e1),[e1]);
  assert.deepEqual(nextEditorEraExpansion([e1],p1),[e1,p1]);
  assert.deepEqual(nextEditorEraExpansion([e1,p1],p1),[e1]);
  assert.deepEqual(nextEditorEraExpansion([e1,p1],e2),[e2]);
  assert.deepEqual(nextEditorEraExpansion([e2],p2),[e2,p2]);
  assert.deepEqual(nextEditorEraExpansion([e2,p2],e2),[]);
  const orphan='time-undefined:lo3rwang';
  assert.deepEqual(nextEditorEraExpansion([e1,p1],orphan),[orphan]);
  assert.deepEqual(nextEditorEraExpansion([orphan],orphan),[]);
});

test('management Time river keeps one non-stacked row per collapsed Era',()=>{
  const sample={...era,ranges:[
    {start_date:'2025-01-01',end_date:'2025-02-15'},
    {start_date:'2025-04-01',end_date:'2025-06-01'}
  ]};
  const model=buildEraRiver([...dates,period,sample],[],{editorOnly:true,scopeId:scope});
  assert.equal(model.groups.length,2);
  assert.equal(model.groups[0].label,'第一時代');
  assert.equal(model.items.filter(row=>row.entry_type==='era').length,2);
  assert.equal(model.groups.at(-1).label,'未定義定錨');
  assert.equal(model.groups.at(-1).expanded,false);
  assert.equal(model.groups.at(-1).collapsible,true);
});
test('undefined Date anchors remain available only when bottom lane is opened',()=>{
  const orphan={uid:'DATE0099',scope_id:scope,entry_type:'anchor',
    start_date:'2030-07-04',title:'未定義日期'};
  const closed=buildEraRiver([...dates,period,era,orphan],[],{editorOnly:true,scopeId:scope});
  assert.equal(closed.groups.at(-1).label,'未定義定錨');
  assert.equal(closed.items.some(row=>row.uid===orphan.uid),false);
  const expanded=buildEraRiver([...dates,period,era,orphan],['time-undefined:'+scope],{
    editorOnly:true,scopeId:scope
  });
  assert.equal(expanded.groups.at(-1).label,'未定義定錨');
  assert.equal(expanded.items.some(row=>row.uid===orphan.uid),true);
});
}

{
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
}
