import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublicReadBudget,MAX_PUBLIC_READS} from '../app/loc/providers/kysely-read-budget.mjs';

test('anonymous burst dispatch holds at most three concurrent reads',async()=>{
  assert.equal(MAX_PUBLIC_READS,3);
  const budget=createPublicReadBudget();
  let active=0,peak=0,started=0;
  let release;
  const gate=new Promise(resolve=>{release=resolve});
  const reads=Array.from({length:9},(_,i)=>budget(async()=>{
    active++;started++;peak=Math.max(peak,active);
    await gate;
    active--;
    return i;
  }));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(started,3);
  release();
  assert.deepEqual(await Promise.all(reads),[0,1,2,3,4,5,6,7,8]);
  assert.equal(peak,3);
});

test('a failed read releases its reserved capacity',async()=>{
  const budget=createPublicReadBudget(1);
  const failed=budget(async()=>{throw new Error('upstream unavailable')});
  const recovered=budget(async()=>42);
  await assert.rejects(failed,/upstream unavailable/);
  assert.equal(await recovered,42);
});

test('a waiting cancelled read rejects immediately and never runs',async()=>{
  const budget=createPublicReadBudget(1);
  let release;
  const gate=new Promise(resolve=>{release=resolve});
  const occupied=budget(async()=>gate);
  const controller=new AbortController();
  let ran=false;
  const queued=budget(async()=>{ran=true;},controller.signal);
  const rejection=assert.rejects(queued,error=>error?.name==='AbortError');
  controller.abort();
  // This must settle while the first request still owns the slot.
  await rejection;
  assert.equal(ran,false);
  const following=budget(async()=>42);
  release();
  await occupied;
  assert.equal(await following,42);
  assert.equal(ran,false);
});

test('already aborted requests never consume a free read slot',async()=>{
  const budget=createPublicReadBudget(1);
  const controller=new AbortController();
  controller.abort();
  await assert.rejects(
    budget(async()=>{throw Error('should not run')},controller.signal),
    error=>error?.name==='AbortError'
  );
  assert.equal(await budget(async()=>7),7);
});

