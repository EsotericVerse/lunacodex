import test from 'node:test';
import assert from 'node:assert/strict';
import {loadStatisticsPageInitialData}
  from '../app/loc/statistics/page-bootstrap.mjs';

test('LOC Statistics bootstrap requests one Taipei calendar-year aggregate',async()=>{
  let calls=0;
  let params;
  const data={earliest:'2020-01-02',scopes:[],rows:[]};
  const result=await loadStatisticsPageInitialData('loc',{
    now:new Date('2026-12-31T16:30:00.000Z'),
    query:async value=>{
      calls++;
      params=new URLSearchParams(value);
      return {data};
    }
  });
  assert.equal(calls,1);
  assert.deepEqual({
    scopeId:result.scopeId,startDate:result.startDate,endDate:result.endDate
  },{scopeId:'loc',startDate:'2027-01-01',endDate:'2027-01-01'});
  assert.equal(params.get('kind'),'loc');
  assert.equal(params.get('scope'),'loc');
  assert.equal(params.get('start'),'2027-01-01');
  assert.equal(params.get('end'),'2027-01-01');
  assert.equal(result.data,data);
});

test('individual Scope Statistics bootstrap uses the daily-total Server Action projection',async()=>{
  let params;
  const data={earliest:'2019-04-03',rows:[]};
  const result=await loadStatisticsPageInitialData('lrunes',{
    now:new Date('2026-11-28T04:00:00.000Z'),
    query:async value=>{params=new URLSearchParams(value);return {data};}
  });
  assert.equal(params.get('kind'),'daily_total');
  assert.equal(params.get('scope'),'lrunes');
  assert.equal(params.get('start'),'2026-01-01');
  assert.equal(params.get('end'),'2026-11-28');
  assert.equal(result.data,data);
});

test('invalid or non-public Scope IDs never call the Statistics Server Action',async()=>{
  let calls=0;
  const query=async()=>{calls++;return {data:{rows:[]}};};
  assert.equal(await loadStatisticsPageInitialData('admin',{query}),null);
  assert.equal(await loadStatisticsPageInitialData('local',{query}),null);
  assert.equal(await loadStatisticsPageInitialData('../loc',{query}),null);
  assert.equal(calls,0);
});

test('failed RSC prefetch falls back to the existing client Server Action path',async()=>{
  const result=await loadStatisticsPageInitialData('lrunes',{
    now:new Date('2026-11-28T04:00:00.000Z'),
    query:async()=>{throw new Error('database temporarily unavailable');}
  });
  assert.equal(result,null);
});
