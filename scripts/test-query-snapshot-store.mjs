import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createQuerySnapshotStore} from '../packages/zenstack/query-snapshot-store.mjs';

test('public query subscribers observe a single stable completed snapshot',()=>{
  const store=createQuerySnapshotStore(),key='["app-bootstrap","loc","index"]';
  const empty=store.getSnapshot(key);
  assert.equal(empty,store.getSnapshot(key));
  assert.equal(empty.hasData,false);
  let events=0;
  const stop=store.subscribe(key,()=>events++);
  const rows={blocks:[{uid:'example'}]};
  store.publish(key,rows);
  assert.equal(events,1);
  assert.equal(store.getSnapshot(key).data,rows);
  assert.equal(store.getSnapshot(key),store.getSnapshot(key));
  stop();
  store.release(key);
  assert.equal(events,1);
  assert.equal(store.size(),0);
  assert.equal(store.getSnapshot(key),empty);
});
test('multiple readers share data; releasing a key notifies only those readers',()=>{
  const store=createQuerySnapshotStore();
  let a=0,b=0;
  const stopA=store.subscribe('a',()=>a++);
  const stopB=store.subscribe('a',()=>b++);
  const stopC=store.subscribe('c',()=>assert.fail('unrelated key updated'));
  store.publish('a',[]);
  assert.equal(a,1);assert.equal(b,1);
  stopA();
  store.release('a');
  assert.equal(a,1);assert.equal(b,2);
  stopB();stopC();
  assert.equal(store.size(),0);
});
test('clear releases all snapshots without retaining stale data',()=>{
  const store=createQuerySnapshotStore();
  store.publish('a',1);store.publish('b',2);
  store.clear();
  assert.equal(store.size(),0);
  assert.equal(store.getSnapshot('a').hasData,false);
  assert.equal(store.getSnapshot('b').hasData,false);
});
