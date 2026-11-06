import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mapBounded} from '../app/loc/bounded-parallel.mjs';

test('100 independent reads run with at most three active database lanes and preserve order',async()=>{
  const items=Array.from({length:100},(_,i)=>i);
  let active=0,peak=0;
  const results=await mapBounded(items,3,async item=>{
    active++;peak=Math.max(active,peak);
    await new Promise(resolve=>setImmediate(resolve));
    active--;
    return item*2;
  });
  assert.equal(peak,3);
  assert.deepEqual(results,items.map(item=>item*2));
});

test('a failing batch prevents new requests but waits for started lanes',async()=>{
  const invoked=[],settled=[];
  let finishSlow;
  const slow=new Promise(resolve=>{finishSlow=resolve;});
  const pending=mapBounded([0,1,2,3],2,async item=>{
    invoked.push(item);
    if(item===0)throw Error('database read failed');
    await slow;
    settled.push(item);
    return item;
  });
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(invoked,[0,1]);
  finishSlow();
  await assert.rejects(pending,/database read failed/);
  assert.deepEqual(settled,[1]);
});

test('empty and bounded inputs do not spin up excess lanes',async()=>{
  let calls=0;
  assert.deepEqual(await mapBounded([],3,async()=>{calls++;}),[]);
  assert.deepEqual(await mapBounded([1,2],3,async value=>{calls++;return value;}),[1,2]);
  assert.equal(calls,2);
});


test('Max MultiPara hard ceiling limits a burst to 10 parallel workers',async()=>{
  const {MAX_MULTIPARA}=await import('../app/loc/bounded-parallel.mjs');
  assert.equal(MAX_MULTIPARA,10);
  let active=0,maximum=0;
  const data=await mapBounded(Array.from({length:60},(_,i)=>i),100,async value=>{
    active++;maximum=Math.max(active,maximum);
    await new Promise(resolve=>setImmediate(resolve));
    active--;return value;
  });
  assert.equal(maximum,10);
  assert.deepEqual(data,Array.from({length:60},(_,i)=>i));
});

test('member comparison reuses bounded lanes rather than an unbounded Promise.all',async()=>{
  const {readFileSync}=await import('node:fs');
  const source=readFileSync(new URL('../app/modular/modules/statistics/LocMemberIntersection.jsx',import.meta.url),'utf8');
  assert.match(source,/import \{mapBounded\} from '\.\.\/\.\.\/\.\.\/loc\/bounded-parallel\.mjs'/);
  assert.match(source,/mapBounded\(chosenIds,3,async id=>\{/);
  assert.doesNotMatch(source,/Promise\.all\(chosenIds\.map/);
  const ids=['scope1','scope2','scope3','scope4'];
  let active=0,maxActive=0;
  const pairs=await mapBounded(ids,3,async id=>{
    active++;
    maxActive=Math.max(maxActive,active);
    await new Promise(resolve=>setImmediate(resolve));
    active--;
    return [id,{rows:[]}];
  });
  assert.ok(maxActive<=3);
  assert.deepEqual(pairs.map(([id])=>id),ids);
});
