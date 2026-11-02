import test from 'node:test';
import assert from 'node:assert/strict';
import {cultureDensityByUnit,simpleTimeRiver,traceHomeMapChoices,nearestTracePlaceIds} from '../app/loc/loc-feature-preferences.mjs';
test('Culture calendar units aggregate only fetched buckets, not dates in stored Anchor',()=>{
 const source=[{category:'a',start_date:'2026-11-01',item_count:2},
 {category:'a',start_date:'2026-11-02',item_count:3},
 {category:'b',start_date:'2026-11-02',item_count:5}];
 assert.strictEqual(cultureDensityByUnit(source,'day'),source);
 assert.deepEqual(cultureDensityByUnit(source,'week').map(x=>[x.category,x.start_date,x.item_count]),
   [['a','2026-10-26',2],['a','2026-11-02',3],['b','2026-11-02',5]]);
 assert.deepEqual(cultureDensityByUnit(source,'month').map(x=>[x.category,x.item_count]),[['a',5],['b',5]]);
});
test('Culture time display selects saved Anchor or Period records without inventing dates',()=>{
 const rows=[{uid:'ABC12345',scope_id:'lo3rwang',entry_type:'anchor',start_date:'2026-11-02'},
 {uid:'PER12345',scope_id:'lo3rwang',entry_type:'period',title:'週期',ranges:[{start_date:'2026-11-01',end_date:'2026-11-02'}]}];
 assert.equal(simpleTimeRiver(rows,'anchor').items[0].uid,'ABC12345');
 assert.equal(simpleTimeRiver(rows,'period').items[0].end_date,'2026-11-02');
 assert.equal(simpleTimeRiver(rows,'period').items.length,1);
});
test('Trace mode selects an existing map type and nearest known real coordinates',()=>{
 const maps=[{trace_type:'path',uid:'P0000001'},{trace_type:'trace',uid:'T0000001'}];
 assert.equal(traceHomeMapChoices(maps,'path').length,1);
 assert.equal(traceHomeMapChoices(maps,'trace')[0].uid,'T0000001');
 assert.deepEqual(traceHomeMapChoices(maps,'anchor'),[]);
 const anchors=[{uid:'A1234567',longitude:121.5,latitude:25},
  {uid:'B1234567',longitude:121.51,latitude:25},
  {uid:'C1234567',longitude:122.5,latitude:25}];
 assert.deepEqual(nearestTracePlaceIds(['A1234567','C1234567','B1234567'],anchors,anchors[0]),
  ['A1234567','B1234567','C1234567']);
});
