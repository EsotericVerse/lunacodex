import test from 'node:test';
import assert from 'node:assert/strict';
import {buildEraRiver} from '../app/loc/culture-time-trace-river.mjs';

const row=(uid,type,title,start_date,end_date,extra={})=>({
  uid,scope_id:'example',entry_type:type,title,start_date,end_date,
  ...extra
});
const source=[
  row('A001','anchor','第一錨','2026-01-01'),
  row('A002','anchor','第二錨','2026-01-03'),
  row('A003','anchor','第三錨','2026-02-01'),
  row('A004','anchor','第四錨','2026-02-06'),
  row('E001','period','單日事件','2026-01-01',null,{
    ranges:[{start_date:'2026-01-01',end_date:'2026-01-01',
      start_anchor_id:'A001',end_anchor_id:null}]}),
  row('E002','period','二錨事件','2026-02-01','2026-02-06',{
    ranges:[{start_date:'2026-02-01',end_date:'2026-02-06',
      start_anchor_id:'A003',end_anchor_id:'A004'}]}),
  row('E002','period','二錨事件','2026-02-01','2026-02-06',{
    ranges:[{start_date:'2026-02-01',end_date:'2026-02-06',
      start_anchor_id:'A003',end_anchor_id:'A004'}]}),
  row('T001','era','時間痕跡甲','2026-01-01','2026-02-06',{anchor_ids:['E002','E001','GONE']}),
  row('T002','era','時間痕跡乙','2026-02-01','2026-02-06',{anchor_ids:['E002']})
];

test('collapsed first river shows only trace labels and no child rows',()=>{
  const data=buildEraRiver(source);
  assert.deepEqual(data.groups.map(x=>x.label),['時間痕跡甲','時間痕跡乙']);
  assert.ok(data.groups.every(x=>x.collapsible&&!x.expanded));
  assert.deepEqual(data.items,[]);
});
test('trace expansion adds ordered event groups and actual endpoints',()=>{
  const data=buildEraRiver(source,['trace:example:T001']);
  assert.deepEqual(data.groups.map(x=>x.id),[
    'trace:example:T001','trace-anchors:example:T001',
    'trace-event:example:T001:E002',
    'trace-event:example:T001:E001','trace-event:example:T001:GONE',
    'trace:example:T002'
  ]);
  assert.equal(data.items.filter(x=>x.entry_type==='anchor').length,7);
  assert.deepEqual(data.items.filter(x=>x.entry_type==='period').map(x=>x.group_key),
    ['trace-event:example:T001:E002','trace-event:example:T001:E001']);
  assert.deepEqual(data.items.filter(x=>x.entry_type==='anchor'&&
    x.group_key.startsWith('trace-event:')).map(x=>x.start_date),
    ['2026-02-01','2026-02-06','2026-01-01']);
  assert.equal(data.items.find(x=>x.id.endsWith(':E001:0:period')).end_date,undefined);
});
test('one event can be reused under two traces without merging separated intervals',()=>{
  const data=buildEraRiver(source,['trace:example:T001','trace:example:T002']);
  assert.equal(data.items.filter(x=>x.entry_type==='anchor'&&x.uid==='A003').length,4,
    'an anchor appears in both expanded traces and their two child event rows');
  assert.equal(data.items.filter(x=>x.entry_type==='period'&&x.era_uid==='T001').length,2);
  assert.equal(data.items.filter(x=>x.era_uid==='T001'&&x.start_date==='2026-01-01'
    &&x.end_date==='2026-02-06').length,0,'gap must not be filled');
});
test('invalid event UID keeps trace group and broken link label without fake anchor',()=>{
  const data=buildEraRiver(source,['trace:example:T001']);
  assert.ok(data.groups.find(x=>x.label==='期間｜失效連線 GONE'));
  assert.ok(!data.items.some(x=>x.period_uid==='GONE'));
});
test('empty trace still appears and can be expanded',()=>{
  const data=buildEraRiver([row('T003','era','空痕跡',null,null,{anchor_ids:[]})]);
  assert.equal(data.groups.length,1);
  assert.equal(data.items.length,0);
});

test('unlinked dated anchors are visible even when no traces exist',()=>{
  const items=[
    row('FREE','anchor','獨立定錨','2026-08-15'),
    row('BAD','anchor','無日期',null),
  ];
  const data=buildEraRiver(items);
  assert.deepEqual(data.groups.map(x=>x.id),['time-anchors:example']);
  assert.deepEqual(data.items,[]);
  const expanded=buildEraRiver(items,['time-anchors:example']);
  assert.deepEqual(expanded.items.map(x=>({uid:x.uid,start:x.start_date,kind:x.entry_type})),[
    {uid:'FREE',start:'2026-08-15',kind:'anchor'}
  ]);
});
test('each Scope has its own permanent anchor lane and stable identifiers',()=>{
  const data=buildEraRiver([
    row('A001','anchor','甲','2026-01-01'),
    row('A001','anchor','乙','2026-01-02',null,{scope_id:'other'})
  ]);
  assert.deepEqual(data.groups.map(x=>x.label),['example · 定錨點','other · 定錨點']);
  assert.deepEqual(data.items,[]);
  const expanded=buildEraRiver([
    row('A001','anchor','甲','2026-01-01'),
    row('A001','anchor','乙','2026-01-02',null,{scope_id:'other'})
  ],['time-anchors:example','time-anchors:other']);
  assert.deepEqual(expanded.items.map(x=>x.id),['time-anchors:example:A001','time-anchors:other:A001']);
});

test('time trace rows retain chronological order instead of moving active periods to the first lane',()=>{
  const data=buildEraRiver(source);
  assert.deepEqual(data.groups.map(group=>group.id),
    ['trace:example:T001','trace:example:T002']);
  assert.deepEqual(data.items,[]);
  const opened=buildEraRiver(source,['trace:example:T001','trace:example:T002']);
  assert.deepEqual(opened.items.filter(item=>item.entry_type==='anchor'&&
    item.group_key.startsWith('trace-anchors:')).map(item=>[item.uid,item.group_key]),[
      ['A001','trace-anchors:example:T001'],['A002','trace-anchors:example:T001'],
      ['A003','trace-anchors:example:T001'],['A004','trace-anchors:example:T001'],
      ['A003','trace-anchors:example:T002'],['A004','trace-anchors:example:T002']
    ]);
  assert.ok(opened.items.filter(x=>x.entry_type==='anchor')
    .every(x=>x.group_key.startsWith('trace-anchors:')?x.display_label==='●':true));
});
test('disconnected traces never absorb anchors in the gap',()=>{
  const data=buildEraRiver([
    row('A101','anchor','頭','2026-01-02'),
    row('A102','anchor','空隙','2026-02-01'),
    row('A103','anchor','尾','2026-03-29'),
    row('T009','era','間斷時期','2026-01-01','2026-03-31',{
      ranges:[{start_date:'2026-01-01',end_date:'2026-01-05'},
        {start_date:'2026-03-25',end_date:'2026-03-31'}]})
  ]);
  const expanded=buildEraRiver([
    row('A101','anchor','頭','2026-01-02'),
    row('A102','anchor','空隙','2026-02-01'),
    row('A103','anchor','尾','2026-03-29'),
    row('T009','era','間斷時期','2026-01-01','2026-03-31',{
      ranges:[{start_date:'2026-01-01',end_date:'2026-01-05'},
        {start_date:'2026-03-25',end_date:'2026-03-31'}]})
  ],['trace:example:T009','time-anchors:example']);
  assert.deepEqual(expanded.items.filter(x=>x.group_key==='trace-anchors:example:T009').map(x=>x.uid),['A101','A103']);
  assert.deepEqual(expanded.items.filter(x=>x.group_key==='time-anchors:example').map(x=>x.uid),['A102']);
  assert.equal(data.groups.find(x=>x.id==='time-anchors:example')?.label,'未歸屬定錨點');
});
test('invalid trace ranges do not swallow unrelated anchors',()=>{
  const data=buildEraRiver([
    row('A101','anchor','有效日期','2026-02-01'),
    row('T009','era','失效時期','2026-01-01','2026-03-01',{
      ranges:[{start_date:'2026-01-01',end_date:'2026-03-01',invalid:true,point:false}]})
  ]);
  assert.deepEqual(data.items,[]);
  const expanded=buildEraRiver([
    row('A101','anchor','有效日期','2026-02-01'),
    row('T009','era','失效時期','2026-01-01','2026-03-01',{
      ranges:[{start_date:'2026-01-01',end_date:'2026-03-01',invalid:true,point:false}]})
  ],['time-anchors:example','trace:example:T009']);
  assert.equal(expanded.items.find(x=>x.uid==='A101')?.group_key,'time-anchors:example');
});

test('a later time trace cannot move early anchors onto its lane',()=>{
  const data=buildEraRiver([
    row('A100','anchor','P1 定錨點','1988-01-01'),
    row('A200','anchor','P6 定錨點','2026-07-01'),
    row('T100','era','P1','1980-01-01','2000-01-01'),
    row('T200','era','P6','2026-01-01','2026-10-06')
  ]);
  assert.deepEqual(data.groups.map(x=>x.id),
    ['trace:example:T100','trace:example:T200']);
  assert.deepEqual(data.items,[]);
  const expanded=buildEraRiver([
    row('A100','anchor','P1 定錨點','1988-01-01'),
    row('A200','anchor','P6 定錨點','2026-07-01'),
    row('T100','era','P1','1980-01-01','2000-01-01'),
    row('T200','era','P6','2026-01-01','2026-10-06')
  ],['trace:example:T100','trace:example:T200']);
  assert.equal(expanded.items.find(x=>x.uid==='A100')?.group_key,'trace-anchors:example:T100');
  assert.equal(expanded.items.find(x=>x.uid==='A200')?.group_key,'trace-anchors:example:T200');
});

test('expanding one trace never pre-opens another trace',()=>{
 const first=buildEraRiver(source,['trace:example:T001']);
 assert.ok(first.groups.some(x=>x.id==='trace-anchors:example:T001'));
 assert.ok(!first.groups.some(x=>x.id==='trace-anchors:example:T002'));
 assert.ok(!first.items.some(x=>x.group_key.includes('T002')));
 const collapsed=buildEraRiver(source);
 assert.equal(collapsed.items.length,0);
});

test('time editor shows Era rows and expands only directly linked Period rows',()=>{
  const collapsed=buildEraRiver(source,[],{editorOnly:true});
  assert.deepEqual(collapsed.groups.map(group=>group.label),['時間痕跡甲','時間痕跡乙']);
  assert.ok(collapsed.groups.every(group=>group.collapsible&&!group.expanded));
  assert.deepEqual(collapsed.items,[]);
  const opened=buildEraRiver(source,['trace:example:T001'],{editorOnly:true});
  assert.deepEqual(opened.groups.map(group=>group.label),[
    '時間痕跡甲','期間｜二錨事件','期間｜單日事件','期間｜失效連線 GONE','時間痕跡乙'
  ]);
  assert.ok(opened.items.every(item=>item.entry_type==='period'));
  assert.deepEqual(opened.items.map(item=>item.uid),['E002','E001']);
  assert.ok(!opened.groups.some(group=>group.id.startsWith('trace-anchors:')));
  assert.ok(!opened.groups.some(group=>group.id.startsWith('time-anchors:')));
});
