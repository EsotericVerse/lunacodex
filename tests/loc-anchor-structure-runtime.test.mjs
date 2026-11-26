import test from 'node:test';
import assert from 'node:assert/strict';
import {readAnchorStructure} from '../app/loc/model/anchor-structure-runtime.mjs';
import {invalidateScopedReadCache} from '../packages/zenstack/scoped-read-cache.mjs';
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
