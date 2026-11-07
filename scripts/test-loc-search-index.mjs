import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../workers/loc-search-index/index.mjs';
import {indexDocumentsFromWrite,withIndexedCandidates} from '../app/loc/providers/search-index-service.mjs';

class KvMemory {
  constructor(){this.data=new Map();this.writes=0;}
  async get(key,kind){const value=this.data.get(key)??null;return value!==null&&kind==='json'?JSON.parse(value):value;}
  async put(key,value){this.writes++;this.data.set(key,String(value));}
  async delete(key){this.data.delete(key);}
  async list({prefix='',limit=1000}={}) {
    const keys=[...this.data.keys()].filter(name=>name.startsWith(prefix)).slice(0,limit)
      .map(name=>({name}));
    return {keys,list_complete:keys.length<limit};
  }
}
const secret='a-test-index-secret-longer-than-32-characters';
const kv=new KvMemory(),env={LOC_KV:kv,LOC_SEARCH_INDEX_SECRET:secret};
async function call(path,body,{method='POST',authorized=true}={}){
  const response=await worker.fetch(new Request('https://index.example.test'+path,{
    method,headers:{'content-type':'application/json',...(authorized?{authorization:'Bearer '+secret}:{})},
    body:JSON.stringify(body)
  }),env);
  return {status:response.status,...await response.json()};
}
const doc=(dbId,uid,content,operation='upsert')=>({
  scopeId:'lo3rwang',dbId,entityType:'galaxy',uid,content,operation
});

test('LOC index preserves identical UIDs across independent SQL datasets',async()=>{
  const a=doc('DB1','Ab123456','文化錨點 漢字遠方的星星');
  const b=doc('DB2','Ab123456','痕跡錨點 山川大海');
  assert.equal((await call('/v1/documents',{documents:[a,b]})).accepted,true);
  assert.equal((await call('/v1/search',{scopeId:'lo3rwang',dbId:'DB1',query:'文化'})).complete,false);
  for(const dbId of ['DB1','DB2']){
    assert.equal((await call('/v1/coverage',{scopeId:'lo3rwang',dbId,complete:true},{method:'PUT'})).accepted,true);
  }
  const resultA=await call('/v1/search',{scopeId:'lo3rwang',dbId:'DB1',query:'文化'});
  const resultB=await call('/v1/search',{scopeId:'lo3rwang',dbId:'DB2',query:'痕跡'});
  assert.equal(resultA.complete,true);
  assert.equal(resultB.complete,true);
  assert.deepEqual(resultA.hits.map(x=>[x.scopeId,x.dbId,x.uid]),[['lo3rwang','DB1','Ab123456']]);
  assert.deepEqual(resultB.hits.map(x=>[x.scopeId,x.dbId,x.uid]),[['lo3rwang','DB2','Ab123456']]);
});

test('append indexes the new suffix without dropping previously indexed words',async()=>{
  const before=await call('/v1/documents',{documents:[doc('DB1','Ab123456','另一個時間段落','append')]});
  assert.equal(before.accepted,true);
  const after=await call('/v1/search',{scopeId:'lo3rwang',dbId:'DB1',query:'時間'});
  assert.equal(after.complete,true);
  assert.equal(after.hits[0]?.uid,'Ab123456');
  const original=await call('/v1/search',{scopeId:'lo3rwang',dbId:'DB1',query:'文化'});
  assert.equal(original.hits[0]?.uid,'Ab123456');
});

test('invalid service authorization is refused before reading index data',async()=>{
  const result=await call('/v1/search',{scopeId:'lo3rwang',dbId:'DB1',query:'文化'},{authorized:false});
  assert.equal(result.status,401);
});

test('independent database removal cannot remove a same-UID document elsewhere',async()=>{
  assert.equal((await call('/v1/documents',{documents:[doc('DB1','Ab123456','','remove')]})).accepted,true);
  assert.equal((await call('/v1/search',{scopeId:'lo3rwang',dbId:'DB1',query:'文化'})).hits.length,0);
  assert.equal((await call('/v1/search',{scopeId:'lo3rwang',dbId:'DB2',query:'痕跡'})).hits[0].uid,'Ab123456');
});

test('Gateway adds only UID IN prefilter after a complete trusted index response',async(t)=>{
  const previousDeno=globalThis.Deno,previousFetch=globalThis.fetch;
  globalThis.Deno={env:{get:name=>name==='LOC_SEARCH_INDEX_URL'?'https://index.example.test':
    name==='LOC_SEARCH_INDEX_SECRET'?secret:''}};
  globalThis.fetch=(url,options)=>worker.fetch(new Request(url,options),env);
  t.after(()=>{globalThis.Deno=previousDeno;globalThis.fetch=previousFetch;});
  const request={kind:'query',operation:'select',schema:'silver',
    table:'lo3rwang_galaxy',columns:['uid','title'],filters:[
      {column:'search',operator:'eq',value:true}],indexHint:{scopeId:'lo3rwang',query:'痕跡'}};
  const indexed=await withIndexedCandidates(request,{connection_alias:'DB2'});
  assert.deepEqual(indexed.filters.at(-1),{column:'uid',operator:'in',value:['Ab123456']});
  assert.deepEqual(indexed.filters[0],request.filters[0]);
  const noCoverage=await withIndexedCandidates(request,{connection_alias:'DB3'});
  assert.equal(noCoverage,request);
});

test('Managed Galaxy writes produce stable dataset-aware index records',()=>{
  const result=indexDocumentsFromWrite({kind:'managed-write',payload:{
    p_table:'lo3rwang_galaxy',p_operation:'insert',
    p_rows:[{uid:'Ab123456',content:'Hello'}]}},
  {connection_alias:'DB2'});
  assert.deepEqual(result,[doc('DB2','Ab123456','Hello')]);
  assert.deepEqual(indexDocumentsFromWrite({kind:'query',operation:'select'},{}),[]);
});
