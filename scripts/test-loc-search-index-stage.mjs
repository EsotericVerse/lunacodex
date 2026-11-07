import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {stageAndPublishLocIndex} from './loc-search-index-stage.mjs';

class FakeIndex {
  constructor(){this.rows=new Map();}
  add(id,content){this.rows.set(id,content);}
  async export(accept){await accept('rows',JSON.stringify([...this.rows]));}
}
const options={
  scopeId:'lo3rwang',dbId:'db1',shardCount:4,
  shardOf:uid=>uid.charCodeAt(0)%4,
  documentId:({dbId,scopeId,uid})=>JSON.stringify([dbId,scopeId,uid]),
  makeIndex:()=>new FakeIndex()
};
async function* input(rows){for(const row of rows)yield row;}
const sample=[
  {uid:'Aa123456',content:'第一篇文章\n分行與引號 "text"'},
  {uid:'Bb123456',content:'第二篇文章'},
  {uid:'Cc123456',content:'第三篇文章'}
];
async function sandbox(t){
  const directory=await mkdtemp(join(tmpdir(),'loc-stage-test-'));
  t.after(async()=>rm(directory,{recursive:true,force:true}));
  return directory;
}
test('one SQL scan and one in-memory index per nonempty shard; cleans temporary data',async t=>{
  const stageDirectory=await sandbox(t);
  let scanned=0;
  async function* rows(){for(const row of sample){scanned++;yield row;}}
  const events=[];
  const report=await stageAndPublishLocIndex({
    ...options,rows:rows(),expected:sample.length,stageDirectory,
    publish:async event=>events.push(event)
  });
  assert.equal(scanned,sample.length);
  assert.deepEqual(report,{indexed:3,shards:3,complete:true});
  assert.deepEqual(events.map(x=>x.phase),['begin','shard','shard','shard','commit']);
  const persisted=events.filter(x=>x.phase==='shard').flatMap(x=>JSON.parse(x.parts.rows));
  assert.equal(persisted.length,3);
  assert.deepEqual(new Set(persisted.map(([id])=>JSON.parse(id)[2])),
    new Set(sample.map(row=>row.uid)));
  assert.ok(persisted.some(([,content])=>content===sample[0].content));
  assert.deepEqual(await readdir(stageDirectory),[]);
});
test('incomplete source fails before resetting the live KV index',async t=>{
  const stageDirectory=await sandbox(t),events=[];
  await assert.rejects(()=>stageAndPublishLocIndex({
    ...options,rows:input(sample.slice(0,2)),expected:3,stageDirectory,
    publish:async event=>events.push(event)
  }),/SQL coverage mismatch/);
  assert.deepEqual(events,[]);
  assert.deepEqual(await readdir(stageDirectory),[]);
});
test('same-database duplicate UID fails before any KV write',async t=>{
  const stageDirectory=await sandbox(t),events=[];
  await assert.rejects(()=>stageAndPublishLocIndex({
    ...options,rows:input([sample[0],sample[0]]),expected:2,stageDirectory,
    publish:async event=>events.push(event)
  }),/duplicated source Galaxy UID/);
  assert.deepEqual(events,[]);
  assert.deepEqual(await readdir(stageDirectory),[]);
});
test('export or upload failure never marks index complete, and removes staged files',async t=>{
  const stageDirectory=await sandbox(t),events=[];
  await assert.rejects(()=>stageAndPublishLocIndex({
    ...options,rows:input(sample),expected:3,stageDirectory,
    publish:async event=>{
      events.push(event.phase);
      if(event.phase==='shard')throw Error('KV unavailable');
    }
  }),/KV unavailable/);
  assert.equal(events[0],'begin');
  assert.ok(!events.includes('commit'));
  assert.deepEqual(await readdir(stageDirectory),[]);
});
test('empty Galaxy dataset still closes coverage with zero index shards',async t=>{
  const stageDirectory=await sandbox(t),events=[];
  const report=await stageAndPublishLocIndex({
    ...options,rows:input([]),expected:0,stageDirectory,
    publish:async event=>events.push(event.phase)
  });
  assert.deepEqual(report,{indexed:0,shards:0,complete:true});
  assert.deepEqual(events,['begin','commit']);
  assert.deepEqual(await readdir(stageDirectory),[]);
});
