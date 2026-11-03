import test from 'node:test';
import assert from 'node:assert/strict';
import {convertLegacyTimeRows} from '../app/loc/time-schema-migration.mjs';
const legacy=[
 {record_id:'uuid-1',record_type:'anchor',resource_id:'birthday',label:'生日',time_date:'1980-06-23'},
 {record_id:'uuid-2',record_type:'anchor',resource_id:'start',label:'開端',time_date:'2003-12-16'},
 {record_id:'uuid-3',record_type:'anchor',resource_id:'end',label:'結束',time_date:'2005-07-01'},
 {record_id:'uuid-4',record_type:'period',resource_id:'P1',label:'時間痕跡甲',anchor_ids:['birthday','start']},
 {record_id:'uuid-5',record_type:'period',resource_id:'P2',label:'時間痕跡乙',anchor_ids:['end','0']},
 {record_id:'uuid-6',record_type:'event',resource_id:'multi',label:'三錨舊事件',anchor_ids:['birthday','start','end']},
 {record_id:'uuid-7',record_type:'style_comment',resource_id:'style1',style_description:'歷史風格'}
];
test('unique eight-character Anchor UIDs and backed-up old records',()=>{
 const {rows,archive}=convertLegacyTimeRows(legacy);
 assert.equal(archive.length,7);
 assert.equal(rows.length,9,'original 6 active rows plus 2 boundary events plus 1 extra legacy segment');
 assert.equal(new Set(rows.map(row=>row.uid)).size,9);
 assert.ok(rows.every(row=>/^[A-Za-z0-9]{8}$/.test(row.uid)));
 assert.ok(rows.every(row=>!('resource_id' in row)&&!('record_id' in row)));
});
test('old periods become traces collecting events with real one/two anchor arrays',()=>{
 const {rows}=convertLegacyTimeRows(legacy);
 const [a,b,c]=rows.filter(row=>row.type==='anchor');
 const traces=rows.filter(row=>row.type==='era');
 const boundaries=rows.filter(row=>row.status==='legacy_boundary');
 assert.equal(boundaries.length,2);
 assert.deepEqual(traces.map(row=>row.anchor_ids),boundaries.map(row=>[row.uid]));
 assert.deepEqual(boundaries[0].anchor_ids,[a.uid,b.uid]);
 assert.deepEqual(boundaries[1].anchor_ids,[c.uid],'legacy 0 no longer extends to now');
 assert.equal(traces[0].address,null);
 assert.equal(a.address,'1980-06-23');
});
test('legacy triple-anchor event is split into two real pairs',()=>{
 const {rows}=convertLegacyTimeRows(legacy);
 const [a,b,c]=rows.filter(row=>row.type==='anchor');
 const original=rows.find(row=>row.title==='三錨舊事件');
 const split=rows.find(row=>row.status==='legacy_split');
 assert.deepEqual(original.anchor_ids,[a.uid,b.uid]);
 assert.deepEqual(split.anchor_ids,[b.uid,c.uid]);
 assert.ok(rows.filter(row=>row.type==='period')
   .every(row=>row.anchor_ids.length>=1&&row.anchor_ids.length<=2));
});
test('historical style notes remain in private archive, not live Time',()=>{
 const {rows,archive}=convertLegacyTimeRows(legacy);
 assert.ok(!rows.some(row=>row.type==='style_comment'));
 assert.equal(archive[6].style_description,'歷史風格');
});
test('unresolved reference aborts conversion rather than manufacturing an anchor',()=>{
 assert.throws(()=>convertLegacyTimeRows([legacy[0],{
  record_id:'bad',record_type:'period',resource_id:'P1',anchor_ids:['birthday','missing']
 }]),/不存在的定錨點/);
});
