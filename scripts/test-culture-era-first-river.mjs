import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {indexZModelAnchorHierarchy} from '../zenstack/anchor-hierarchy.mjs';

const source=readFileSync(new URL('../app/loc/views/CulturePublicReader.jsx',import.meta.url),'utf8');
const start=source.indexOf('function anchorModel(');
const end=source.indexOf('function sourceModel(',start);
assert.ok(start>=0&&end>start,'first river model is present');
const anchorModel=vm.runInNewContext(`(() => {
  const list=value=>Array.isArray(value)?value:[];
  const datePart=value=>String(value||'').slice(0,10);
  const attributes=row=>row?.attr||{};
  ${source.slice(start,end)}
  return anchorModel;
})()`,{indexZModelAnchorHierarchy});

const rows=[
  {uid:'e1',type:'era',title:'近代',attr:{periods:['p1','p2']}},
  {uid:'e2',type:'era',title:'過去',attr:{periods:['p3']}},
  {uid:'p1',type:'period',title:'一月',attr:{dates:['2026-01-01','2026-01-31']}},
  {uid:'p2',type:'period',title:'三月',attr:{dates:['2026-03-01','2026-03-31']}},
  {uid:'p3',type:'period',title:'前年',attr:{dates:['2024-01-01','2024-02-01']}},
  {uid:'d1',type:'date',title:'第一點',attr:{date:'2026-01-07'}},
  {uid:'d2',type:'date',title:'第二點',attr:{date:'2026-03-06'}},
  {uid:'gap',type:'date',title:'期間間隔',attr:{date:'2026-02-02'}},
  {uid:'outside',type:'date',title:'無所屬',attr:{date:'2026-04-01'}}
];
test('collapsed first river sidebar contains era rows only',()=>{
  const model=anchorModel(rows,'2025-11-06','2026-11-06',[]);
  assert.deepEqual(Array.from(model.groups,g=>g.id),['era:e1','era:e2']);
  assert.equal(model.groups[0].collapsible,true);
  assert.equal(model.groups[0].expanded,false);
  assert.equal(model.items.filter(row=>row.entry_type==='period').length,0);
});
test('dates display on era lane, not a separate date lane or disconnected gap',()=>{
  const model=anchorModel(rows,'2025-11-06','2026-11-06',[]);
  assert.deepEqual(Array.from(model.items.filter(row=>row.entry_type==='anchor'),row=>row.id),
    ['era:e1:date:d1','era:e1:date:d2']);
  assert.ok(model.items.filter(row=>row.entry_type==='anchor')
    .every(row=>row.group_key==='era:e1'));
});
test('expanding one era shows only its periods, with no free-standing period rows',()=>{
  const model=anchorModel(rows,'2025-11-06','2026-11-06',['e1']);
  assert.deepEqual(Array.from(model.groups,g=>g.id),
    ['era:e1','period:e1:p1','period:e1:p2','era:e2']);
  assert.equal(model.items.filter(row=>row.entry_type==='period').length,2);
  assert.equal(model.groups[0].expanded,true);
});
test('default culture homepage window is one calendar year in Taipei',()=>{
  assert.match(source,/const start=useMemo\(\(\)=>previousYear\(today\),\[today\]\)/);
  assert.match(source,/d\.setUTCFullYear\(d\.getUTCFullYear\(\)-1\)/);
  assert.match(source,/windowStart=\{start\} windowEnd=\{today\}/);
});

test('canonical eight-character Era uses existing ZModel Time relationships',()=>{
  const era='ERA00001',period='PER00001',date='DAY00001';
  const model=anchorModel([
    {uid:era,type:'era',title:'新時代',attr:{period:[period]}},
    {uid:period,type:'period',title:'新階段',attr:{uid:[date]}},
    {uid:date,type:'date',title:'定錨',attr:{date:'2026-01-10'}}
  ],'2026-01-01','2026-01-31',[era]);
  assert.deepEqual(Array.from(model.groups,row=>row.id),[
    'era:'+era,'period:'+era+':'+period
  ]);
  assert.deepEqual(Array.from(model.items.filter(row=>row.entry_type==='anchor'),
    row=>row.uid),[date]);
  assert.match(source,/indexZModelAnchorHierarchy\(canonical,\{family:'time'\}\)/);
  assert.match(source,/timeGraph\.childrenOf\(uid\)/);
});

test('mixed legacy and canonical UIDs do not disable canonical ZModel Time',()=>{
  const era='ERA00001',period='PER00001',date='DAY00001';
  const data=[
    {uid:'e1',type:'era',title:'舊時代',attr:{periods:['p1']}},
    {uid:'p1',type:'period',title:'舊期間',attr:{dates:['2026-01-01','2026-02-01']}},
    {uid:era,type:'era',title:'新時代',attr:{period:[period]}},
    {uid:period,type:'period',title:'新期間',attr:{uid:[date]}},
    {uid:date,type:'date',title:'新日期',attr:{date:'2026-01-10'}}
  ];
  const calls=[];
  const code='(() => {const list=value=>Array.isArray(value)?value:[];'+
    'const datePart=value=>String(value||\'\').slice(0,10);'+
    'const attributes=row=>row?.attr||{};'+source.slice(start,end)+';return anchorModel;})()';
  const model=vm.runInNewContext(code,{indexZModelAnchorHierarchy:(rows,opts)=>{
    calls.push({uids:rows.map(x=>x.uid),family:opts.family});
    return indexZModelAnchorHierarchy(rows,opts);
  }});
  const result=model(data,'2026-01-01','2026-02-28',[era]);
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0].uids,[era,period,date]);
  assert.deepEqual(Array.from(result.items.filter(x=>x.entry_type==='period'),x=>x.uid),[period]);
  assert.ok(result.items.some(x=>x.uid===date&&x.entry_type==='anchor'));
  assert.ok(result.groups.some(x=>x.id==='era:e1'));
});
