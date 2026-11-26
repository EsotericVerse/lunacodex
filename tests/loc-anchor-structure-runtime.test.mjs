import test from 'node:test';
import assert from 'node:assert/strict';
import {readAnchorStructure} from '../app/loc/model/anchor-structure-runtime.mjs';
import {invalidateScopedReadCache,getOrLoadScopedRead} from '../packages/zenstack/scoped-read-cache.mjs';
const browser={browser:true};
const typesByFamily={source:['from','domain','galaxy','universe'],time:['era','period','date'],space:['trace','path','point']};
function fixture(){
  const calls=[];
  const load=async options=>{
    calls.push(options);
    return (options.types||typesByFamily[options.family]).map(type=>({
      uid:options.scope+'-'+type,type,title:options.scope
    }));
  };
  return {calls,read:(options,mode=browser)=>readAnchorStructure(options,load,mode)};
}
test('one public source tree is reused, editor and server reads remain fresh',async()=>{
  invalidateScopedReadCache();
  const {calls,read}=fixture();
  const options={scope:'loc',family:'source'};
  await read(options);
  await read({...options,types:['universe','galaxy','domain','from']});
  assert.equal(calls.length,1);
  await read({...options,editor:true});
  await read(options,{browser:false});
  assert.equal(calls.length,3);
  invalidateScopedReadCache('silver.loc_anchor');
  await read(options);
  assert.equal(calls.length,4);
});
test('Time and Space parent structures are scope-separated; leaves remain live',async()=>{
  invalidateScopedReadCache();
  const {calls,read}=fixture();
  const time={scope:'lo3rwang',family:'time',types:['date','era','period']};
  const first=await read(time);
  const second=await read(time);
  assert.deepEqual(first,second);
  assert.deepEqual(first.map(row=>row.type),['date','period','era']);
  assert.equal(calls.filter(c=>c.types.includes('era')).length,1);
  assert.equal(calls.filter(c=>c.types.includes('date')).length,2);
  await read({...time,scope:'lrunes'});
  const before=calls.length;
  await read({scope:'lo3rwang',family:'space',types:['trace','path','point']});
  await read({scope:'lo3rwang',family:'space',types:['point','path','trace']});
  assert.equal(calls.length-before,3);
  invalidateScopedReadCache('silver.lo3rwang_anchor');
  const after=calls.length;
  await read({...time,scope:'lrunes'});
  assert.equal(calls.length-after,1);
  await read(time);
  assert.equal(calls.length-after,3);
});
test('cancelled caller cannot poison a shared structure read',async()=>{
  invalidateScopedReadCache();
  let resolve,calls=0;
  const load=()=>{calls++;return new Promise(r=>{resolve=r;});};
  const options={scope:'loc',family:'source'};
  const controller=new AbortController();
  const a=readAnchorStructure({...options,signal:controller.signal},load,browser);
  const b=readAnchorStructure(options,load,browser);
  await Promise.resolve();
  controller.abort();
  resolve([{uid:'one',type:'from'}]);
  await assert.rejects(a,{name:'AbortError'});
  assert.deepEqual(await b,[{uid:'one',type:'from'}]);
  assert.equal(calls,1);
});
test('date filters, editor reads, media and invalid inputs do not enter the shared cache',async()=>{
  invalidateScopedReadCache();
  const {calls,read}=fixture();
  const values=[
    {scope:'lo3rwang',family:'time',types:['date']},
    {scope:'lo3rwang',family:'space',types:['point']},
    {scope:'lo3rwang',family:'media',types:['image']},
    {scope:'lo3rwang',family:'time',types:['era'],startDate:''},
    {scope:'lo3rwang',family:'time',types:['era'],editor:true},
    {scope:'lo3rwang',family:'source',types:['from']}
  ];
  for(const options of values){await read(options);await read(options);}
  assert.equal(calls.length,values.length*2);
});

test('shared reads abort only after the final consumer leaves and never cache an abandoned result',async()=>{
  invalidateScopedReadCache();
  let calls=0,resolveFirst,transportSignal;
  const load=({signal})=>{
    calls++;
    transportSignal=signal;
    return new Promise(resolve=>{resolveFirst=resolve;});
  };
  const a=new AbortController(),b=new AbortController();
  const first=getOrLoadScopedRead('silver.loc_anchor',['shared-cancel'],load,{signal:a.signal});
  const second=getOrLoadScopedRead('silver.loc_anchor',['shared-cancel'],load,{signal:b.signal});
  await Promise.resolve();
  a.abort();
  await assert.rejects(first,{name:'AbortError'});
  assert.equal(transportSignal.aborted,false);
  b.abort();
  await assert.rejects(second,{name:'AbortError'});
  assert.equal(transportSignal.aborted,true);
  resolveFirst('abandoned');
  await Promise.resolve();
  await Promise.resolve();
  const fresh=await getOrLoadScopedRead('silver.loc_anchor',['shared-cancel'],
    async()=>{calls++;return 'fresh';});
  assert.equal(fresh,'fresh');
  assert.equal(calls,2);
});
test('resolved public structure is reused until relation invalidation',async()=>{
  invalidateScopedReadCache();
  let calls=0;
  const load=async()=>({uid:'structure-'+(++calls)});
  const first=await getOrLoadScopedRead('silver.lo3rwang_anchor',['public-tree'],load);
  const second=await getOrLoadScopedRead('silver.lo3rwang_anchor',['public-tree'],load);
  assert.deepEqual(second,first);
  assert.equal(calls,1);
  invalidateScopedReadCache('silver.lo3rwang_anchor');
  const third=await getOrLoadScopedRead('silver.lo3rwang_anchor',['public-tree'],load);
  assert.notDeepEqual(third,first);
  assert.equal(calls,2);
});
