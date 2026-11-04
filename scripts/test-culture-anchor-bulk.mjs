import test from 'node:test';
import assert from 'node:assert/strict';
import {planAnniversaryDates,collectTimeDates,collectEraPeriods} from '../app/loc/culture-anchor-bulk.mjs';

test('anniversary planner only proposes valid same-month-day dates',()=>{
 const rows=planAnniversaryDates({title:'開站',originDate:'2019-05-12',
  startYear:2020,endYear:2025,firstAnniversary:1,lastAnniversary:5});
 assert.deepEqual(rows.map(x=>x.date),['2020-05-12','2021-05-12','2022-05-12','2023-05-12','2024-05-12']);
 const leap=planAnniversaryDates({title:'閏日',originDate:'2020-02-29',
  startYear:2021,endYear:2028,firstAnniversary:1,lastAnniversary:8});
 assert.deepEqual(leap.map(x=>x.date),['2024-02-29','2028-02-29']);
});
test('period collection only sees stored date anchors inside inclusive bounds',()=>{
 const rows=[{uid:'Date0001',type:'anchor',address:'2021-03-01'},
  {uid:'Date0002',type:'anchor',address:'2021-03-30'},
  {uid:'Date0003',type:'anchor',address:'2021-04-01'},
  {uid:'Virtual1',type:'aniversary',address:'2021-03-12'}];
 assert.deepEqual(collectTimeDates('2021-03-01','2021-03-30',rows).map(x=>x.uid),
  ['Date0001','Date0002']);
});
test('era organization never includes periods beyond existing windows',()=>{
 const anchors=[
  {uid:'Date0001',address:'2021-01-01'},{uid:'Date0002',address:'2021-12-31'},
  {uid:'Date0003',address:'2021-03-01'},{uid:'Date0004',address:'2021-06-01'},
  {uid:'Date0005',address:'2020-01-01'}
 ];
 const periods=[
  {uid:'Per00001',anchor_ids:['Date0001','Date0002']},
  {uid:'Per00002',anchor_ids:['Date0003','Date0004']},
  {uid:'Per00003',anchor_ids:['Date0005','Date0004']}
 ];
 assert.deepEqual(collectEraPeriods(['Per00001'],periods,anchors).map(x=>x.uid),
  ['Per00001','Per00002']);
});
