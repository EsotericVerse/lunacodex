import test from 'node:test';
import assert from 'node:assert/strict';
import {timeRecordHierarchy} from '../app/loc/culture/time-record-hierarchy-options.mjs';
import {resolveTimeSegments} from '../app/loc/culture/time-anchor-ranges.mjs';
import {resolveTimeTrace} from '../app/loc/culture/time-anchor-ranges.mjs';
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

}

{
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

}

{
const scope='lo3rwang';
test('Trace never attaches a different Scope Path by matching UID',()=>{
  const t=traceRouteHierarchy([
    {uid:'AAAA0001',trace_type:'trace',source_scope:scope,
      route_list:{routes:['BBBB0002']}},
    {uid:'BBBB0002',trace_type:'path',source_scope:'lrunes'}
  ],scope);
  assert.deepEqual(t.groups[0].paths,[]);
});
}
