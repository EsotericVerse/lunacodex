import test from 'node:test';
import assert from 'node:assert/strict';
import {readScopeStatisticsCached,invalidateScopeStatisticsCached,notifyScopeDataCommitted}
  from '../app/loc/scope-statistics-cache.mjs';

test('one Scope and query shape reuses a completed SQL aggregation',async()=>{
  let calls=0;
  const args={startDate:'2026-01-01',endDate:'2026-12-31'};
  const load=()=>{calls++;return [{day:'2026-11-12',item_count:49674}];};
  const first=await readScopeStatisticsCached('lo3rwang','daily',args,load);
  const second=await readScopeStatisticsCached('lo3rwang','daily',args,load);
  assert.strictEqual(second,first);
  assert.equal(calls,1);
});

test('invalidation refreshes only the written Scope without affecting another Scope',async()=>{
  let calls=0;
  const load=()=>{calls++;return {value:calls};};
  await readScopeStatisticsCached('scopea','daily',{},load);
  await readScopeStatisticsCached('scopeb','daily',{},load);
  invalidateScopeStatisticsCached('scopea');
  assert.equal((await readScopeStatisticsCached('scopea','daily',{},load)).value,3);
  assert.equal((await readScopeStatisticsCached('scopeb','daily',{},load)).value,2);
  assert.equal(calls,3);
});

test('a failed read is evicted and can be retried',async()=>{
  let calls=0;
  await assert.rejects(readScopeStatisticsCached('failtest','totals',{},()=>{
    calls++;
    throw Error('SQL unavailable');
  }),/SQL unavailable/);
  const result=await readScopeStatisticsCached('failtest','totals',{},()=>{
    calls++;
    return {total:50};
  });
  assert.equal(result.total,50);
  assert.equal(calls,2);
});

test('late in-flight read cannot refill an invalidated Scope cache',async()=>{
  let release;
  const old=readScopeStatisticsCached('race','daily',{},()=>new Promise(r=>{release=r;}));
  await Promise.resolve();
  invalidateScopeStatisticsCached('race');
  const next=await readScopeStatisticsCached('race','daily',{},()=>({new:true}));
  release({new:false});
  await old;
  assert.deepEqual(await readScopeStatisticsCached('race','daily',{},()=>{throw Error('Unexpected refetch');}),next);
});

test('commit event invalidates existing SQL aggregate and carries time/count metadata',async()=>{
  let calls=0;
  const originalWindow=globalThis.window;
  const originalCustomEvent=globalThis.CustomEvent;
  const events=[];
  try{
    globalThis.window={dispatchEvent:event=>{events.push(event);return true;}};
    globalThis.CustomEvent=class{
      constructor(type,{detail}){this.type=type;this.detail=detail;}
    };
    const read=()=>++calls;
    assert.equal(await readScopeStatisticsCached('revisions','daily',{},read),1);
    assert.equal(notifyScopeDataCommitted('revisions',{
      updatedAt:'2026-11-12T00:00:00.000Z',counts:{inserted:20,updated:3}
    }),true);
    assert.equal(await readScopeStatisticsCached('revisions','daily',{},read),2);
    assert.deepEqual(events.map(event=>event.type),['loc-scope-data-committed']);
    assert.equal(events[0].detail.scopeId,'revisions');
    assert.equal(events[0].detail.updatedAt,'2026-11-12T00:00:00.000Z');
    assert.deepEqual(events[0].detail.counts,{inserted:20,updated:3});
  }finally{
    if(originalWindow===undefined)delete globalThis.window;
    else globalThis.window=originalWindow;
    if(originalCustomEvent===undefined)delete globalThis.CustomEvent;
    else globalThis.CustomEvent=originalCustomEvent;
  }
});
