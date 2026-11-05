import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

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
})()`);

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
