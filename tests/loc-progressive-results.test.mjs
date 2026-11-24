import test from 'node:test';
import assert from 'node:assert/strict';
import {mapBounded} from '../app/loc/query/bounded-parallel.mjs';
import {buildLocCultureScopePreview} from '../app/loc/culture/loc-scope-preview.mjs';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('Existing independent reads publish a single slow midpoint without duplicate work',async()=>{
  const seen=[],calls=[];
  const final=await mapBounded([1,2,3,4],2,async n=>{
    calls.push(n);if(n>2)await sleep(35);return n;
  },{slowMs:10,onCheckpoint:(rows,progress)=>seen.push({rows,progress})});
  assert.deepEqual(final,[1,2,3,4]);
  assert.deepEqual(calls,[1,2,3,4]);
  assert.deepEqual(seen,[{rows:[1,2],progress:{completed:2,total:4}}]);
});
test('Fast and aborted work does not publish an intermediate snapshot',async()=>{
  const seen=[];
  await mapBounded([1,2],2,async n=>n,{slowMs:20,onCheckpoint:v=>seen.push(v)});
  const c=new AbortController();
  await mapBounded([1,2],2,async n=>{if(n===2){c.abort();await sleep(12);}return n;},
    {slowMs:0,signal:c.signal,onCheckpoint:v=>seen.push(v)});
  assert.deepEqual(seen,[]);
});
test('Pending Scope labels are unknown, not measured zero',()=>{
  const result=buildLocCultureScopePreview({scopes:[{id:'a'},{id:'b'},{id:'c'}],completedScopeIds:['a','b'],
    scopeRanges:[{scope_id:'a',start_date:'2026-11-24',item_count:12}]});
  assert.deepEqual(result.groups.map(g=>g.label),['a（12）','b（0）','c（—）']);
  assert.equal(result.items.length,1);
});
