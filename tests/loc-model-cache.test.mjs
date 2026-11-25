import test from 'node:test';
import assert from 'node:assert/strict';
import {readPublicModelCache,beginModelCacheWrite,modelCacheStatus,
  setModelCacheEnabled} from '../app/loc/db/model-cache.mjs';

function memoryBucket(){
  const entries=new Map();
  let serial=0;
  return {entries,async get(key){
    const row=entries.get(key);
    return row?{etag:row.etag,size:Buffer.byteLength(row.value),
      json:async()=>JSON.parse(row.value)}:null;
  },async put(key,value,{onlyIf}={}){
    const old=entries.get(key);
    if(onlyIf?.etagMatches&&old?.etag!==onlyIf.etagMatches)return null;
    if(onlyIf?.etagDoesNotMatch==='*'&&old)return null;
    const etag=String(++serial);
    entries.set(key,{value,etag});return {etag};
  }};
}
const selection={scope:'lo3rwang',model:'culture_density',args:['2026-01-01','2026-11-25']};
test('public projection is reused, with no database read on cache hit',async()=>{
  const env={LOC_MODEL_CACHE:memoryBucket()};
  let calls=0;
  const load=async()=>({data:[{count:++calls}]});
  assert.deepEqual(await readPublicModelCache(selection,load,env),{data:[{count:1}]});
  assert.deepEqual(await readPublicModelCache(selection,load,env),{data:[{count:1}]});
  assert.equal(calls,1);
  await readPublicModelCache({...selection,args:['other']},load,env);
  assert.equal(calls,2);
  assert.equal(env.LOC_MODEL_CACHE.entries.size,2);
});
test('overlapping writes fence all cache reads and stale regeneration',async()=>{
  const env={LOC_MODEL_CACHE:memoryBucket()};
  let calls=0;
  const load=async()=>++calls;
  assert.equal(await readPublicModelCache(selection,load,env),1);
  const a=await beginModelCacheWrite(env),b=await beginModelCacheWrite(env);
  assert.equal((await modelCacheStatus(env)).pending,2);
  assert.equal(await readPublicModelCache(selection,load,env),2);
  await a();
  assert.equal(await readPublicModelCache(selection,load,env),3);
  await b();
  assert.equal(await readPublicModelCache(selection,load,env),4);
  assert.equal(await readPublicModelCache(selection,load,env),4);
  let complete;
  const old=readPublicModelCache({...selection,args:['new']},
    ()=>new Promise(resolve=>{complete=resolve;}),env);
  while(!complete)await new Promise(resolve=>setImmediate(resolve));
  const end=await beginModelCacheWrite(env);await end();complete(999);
  assert.equal(await old,999);
  assert.equal(await readPublicModelCache({...selection,args:['new']},load,env),5);
});
test('R2 toggle is persistent; bypass and re-enable never return retired data',async()=>{
  const env={LOC_MODEL_CACHE:memoryBucket()};
  let calls=0;const load=async()=>++calls;
  assert.equal(await readPublicModelCache(selection,load,env),1);
  await setModelCacheEnabled(false,env);
  assert.equal((await modelCacheStatus(env)).enabled,false);
  assert.equal(await readPublicModelCache(selection,load,env),2);
  await setModelCacheEnabled(true,env);
  assert.equal(await readPublicModelCache(selection,load,env),3);
  assert.equal(await readPublicModelCache(selection,load,env),3);
});
test('no raw articles or unknown models; R2 read failure falls back to SQL',async()=>{
  const env={LOC_MODEL_CACHE:memoryBucket()};
  await readPublicModelCache({...selection,model:'raw_article'},async()=>({content:'private'}),env);
  assert.equal(env.LOC_MODEL_CACHE.entries.size,0);
  const broken={LOC_MODEL_CACHE:{get:async()=>{throw Error('test offline');},put:async()=>{}}};
  assert.equal(await readPublicModelCache(selection,async()=>42,broken),42);
});
