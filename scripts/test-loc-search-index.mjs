import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../workers/loc-search-index/index.mjs';
import {indexDocumentsFromWrite,withIndexedCandidates,federatedIndexedCandidates} from '../app/loc/providers/search-index-service.mjs';
import {locSearchDocumentId} from '../app/loc/search-index-shard.mjs';
import {locGlobalUid,parseLocGlobalUid} from '../zenstack/global-identity.mjs';
import {createKyselyEdgeClient} from '../app/loc/providers/kysely-edge.mjs';

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
  const a=doc('db1','Ab123456','文化錨點 漢字遠方的星星');
  const b=doc('db2','Ab123456','痕跡錨點 山川大海');
  assert.equal((await call('/v1/documents',{documents:[a,b]})).accepted,true);
  assert.equal((await call('/v1/search',{scopeId:'lo3rwang',dbId:'db1',query:'文化'})).complete,false);
  for(const dbId of ['db1','db2']){
    assert.equal((await call('/v1/coverage',{scopeId:'lo3rwang',dbId,complete:true,shards:[]},{method:'PUT'})).accepted,true);
  }
  const resultA=await call('/v1/search',{scopeId:'lo3rwang',dbId:'db1',query:'文化'});
  const resultB=await call('/v1/search',{scopeId:'lo3rwang',dbId:'db2',query:'痕跡'});
  assert.equal(resultA.complete,true);
  assert.equal(resultB.complete,true);
  assert.deepEqual(resultA.hits.map(x=>[x.scopeId,x.dbId,x.uid]),[['lo3rwang','db1','Ab123456']]);
  assert.deepEqual(resultB.hits.map(x=>[x.scopeId,x.dbId,x.uid]),[['lo3rwang','db2','Ab123456']]);
});

test('coverage requires a shard manifest, and status is credential protected',async()=>{
  const source={scopeId:'lo3rwang',dbId:'db1',entityType:'galaxy'};
  const bad=await call('/v1/coverage',{...source,complete:true},{method:'PUT'});
  assert.equal(bad.status,400);
  const status=await call('/v1/status',source);
  assert.equal(status.status,200);
  assert.equal(status.indexVersion,2);
  assert.equal(status.ready,true);
  assert.equal(status.baseShards,0);
  const denied=await call('/v1/status',source,{authorized:false});
  assert.equal(denied.status,401);
});

test('manifest-referenced but invisible base shard never gives a false complete result',async()=>{
  const source={scopeId:'lo3rwang',dbId:'db1',entityType:'galaxy'};
  assert.equal((await call('/v1/coverage',{
    ...source,complete:true,shards:[0]
  },{method:'PUT'})).accepted,true);
  // Missing KV data must not silently behave like an empty index.
  const result=await call('/v1/search',{...source,query:'文化'});
  assert.equal(result.status,503);
  assert.equal((await call('/v1/coverage',{
    ...source,complete:true,shards:[]
  },{method:'PUT'})).accepted,true);
});

test('append indexes the new suffix without dropping previously indexed words',async()=>{
  const before=await call('/v1/documents',{documents:[doc('db1','Ab123456','另一個時間段落','append')]});
  assert.equal(before.accepted,true);
  const after=await call('/v1/search',{scopeId:'lo3rwang',dbId:'db1',query:'時間'});
  assert.equal(after.complete,true);
  assert.equal(after.hits[0]?.uid,'Ab123456');
  const original=await call('/v1/search',{scopeId:'lo3rwang',dbId:'db1',query:'文化'});
  assert.equal(original.hits[0]?.uid,'Ab123456');
});

test('invalid service authorization is refused before reading index data',async()=>{
  const result=await call('/v1/search',{scopeId:'lo3rwang',dbId:'db1',query:'文化'},{authorized:false});
  assert.equal(result.status,401);
});

test('a removed article keeps only a harmless stale candidate, never affects another database',async()=>{
  const writes=kv.writes;
  assert.equal((await call('/v1/documents',{documents:[doc('db1','Ab123456','','remove')]})).accepted,true);
  assert.equal(kv.writes,writes,'no new index writes needed for removed content');
  // The index is a candidate filter, not the content authority. Stale
  // candidates from removed or edited documents are rejected by SQL.
  assert.equal((await call('/v1/search',{scopeId:'lo3rwang',dbId:'db1',query:'文化'})).hits[0].dbId,'db1');
  assert.equal((await call('/v1/search',{scopeId:'lo3rwang',dbId:'db2',query:'痕跡'})).hits[0].uid,'Ab123456');
});

test('one cross-dataset search returns both distinct documents with colliding UIDs',async()=>{
  const merged=await call('/v1/search',{scopeId:'lo3rwang',dbIds:['db1','db2'],query:'錨點'});
  assert.equal(merged.complete,true);
  assert.deepEqual(new Set(merged.hits.map(x=>x.dbId)),new Set(['db1','db2']));
  assert.equal(new Set(merged.hits.map(x=>x.uid)).size,1);
});

test('an append writes a delta segment, not a rewrite of any base shard',async()=>{
  const previous=kv.writes;
  const baseKeys=[...kv.data.keys()].filter(x=>x.startsWith('loc-search/v2/data/'));
  assert.equal((await call('/v1/documents',{documents:[doc('db1','Ab123456','跨資料來源','append')]})).accepted,true);
  assert.equal(kv.writes,previous+1);
  assert.deepEqual([...kv.data.keys()].filter(x=>x.startsWith('loc-search/v2/data/')),baseKeys);
});

test('Gateway adds only UID IN prefilter after a complete trusted index response',async(t)=>{
  const previousDeno=globalThis.Deno,previousFetch=globalThis.fetch;
  globalThis.Deno={env:{get:name=>name==='LOC_SEARCH_INDEX_URL'?'https://index.example.test':
    name==='LOC_SEARCH_INDEX_SECRET'?secret:
    name==='LOC_SEARCH_INDEX_ENABLED'?'true':''}};
  globalThis.fetch=(url,options)=>worker.fetch(new Request(url,options),env);
  t.after(()=>{globalThis.Deno=previousDeno;globalThis.fetch=previousFetch;});
  const request={kind:'query',operation:'select',schema:'silver',
    table:'lo3rwang_galaxy',columns:['uid','title'],filters:[
      {column:'search',operator:'eq',value:true}],indexHint:{scopeId:'lo3rwang',query:'痕跡'}};
  const indexed=await withIndexedCandidates(request,{connection_alias:'db2'});
  assert.deepEqual(indexed.filters.at(-1),{column:'uid',operator:'in',value:['Ab123456']});
  assert.deepEqual(indexed.filters[0],request.filters[0]);
  const noCoverage=await withIndexedCandidates(request,{connection_alias:'db3'});
  assert.equal(noCoverage,request);
});

test('Managed Galaxy writes produce stable dataset-aware index records',()=>{
  const result=indexDocumentsFromWrite({kind:'managed-write',payload:{
    p_table:'lo3rwang_galaxy',p_operation:'insert',
    p_rows:[{uid:'Ab123456',content:'Hello'}]}},
  {connection_alias:'db2'});
  assert.deepEqual(result,[doc('db2','Ab123456','Hello')]);
  assert.deepEqual(indexDocumentsFromWrite({kind:'query',operation:'select'},{}),[]);
});

test('index document identity uses exact PR #1219 canonical ZModel federation',()=>{
  const first=locGlobalUid({databaseId:'db1',scopeId:'lo3rwang',uid:'Ab123456'});
  const second=locGlobalUid({databaseId:'db2',scopeId:'lo3rwang',uid:'Ab123456'});
  assert.notEqual(first,second);
  assert.deepEqual(parseLocGlobalUid(first),{databaseId:'db1',scopeId:'lo3rwang',uid:'Ab123456'});
  assert.equal(locSearchDocumentId({scopeId:'lo3rwang',dbId:'db1',entityType:'galaxy',uid:'Ab123456'}),
    JSON.stringify(['galaxy',first]));
  assert.notEqual(locSearchDocumentId({scopeId:'lo3rwang',dbId:'db1',entityType:'anchor',uid:'Ab123456'}),
    JSON.stringify(['galaxy',first]));
  assert.throws(()=>locSearchDocumentId({scopeId:'lo3rwang',dbId:'DB1',uid:'Ab123456'}),/Invalid LOC database ID/);
});

test('search index hit qualification never trusts a different database ID',async(t)=>{
  const previousDeno=globalThis.Deno,previousFetch=globalThis.fetch;
  globalThis.Deno={env:{get:name=>name==='LOC_SEARCH_INDEX_URL'?'https://index.example.test':
    name==='LOC_SEARCH_INDEX_SECRET'?secret:
    name==='LOC_SEARCH_INDEX_ENABLED'?'true':''}};
  globalThis.fetch=async()=>new Response(JSON.stringify({complete:true,hits:[{
    scopeId:'lo3rwang',dbId:'db2',entityType:'galaxy',uid:'Ab123456',
    globalUid:'db1:lo3rwang:Ab123456'
  }]}),{status:200});
  t.after(()=>{globalThis.Deno=previousDeno;globalThis.fetch=previousFetch;});
  const query={kind:'query',schema:'silver',table:'lo3rwang_galaxy',operation:'select',
    indexHint:{scopeId:'lo3rwang',query:'文化'},filters:[]};
  assert.equal(await withIndexedCandidates(query,{connection_alias:'db2'}),query);
});

test('Gateway transport carries DB identity as an assertion rather than an SQL target selector',async()=>{
  let submitted;
  const gateway=createKyselyEdgeClient({
    gatewayUrl:'https://gateway.example.test/v1/sql',role:'anon',
    fetch:async(_url,options)=>{
      submitted=JSON.parse(options.body);
      return new Response(JSON.stringify({data:[],count:null}),{status:200});
    }
  });
  const result=await gateway.schema('silver').from('lo3rwang_galaxy')
    .select('uid,title').eq('uid','Ab123456').expectDatabase('db2');
  assert.deepEqual(result.data,[]);
  assert.equal(submitted.target,'configured');
  assert.equal(submitted.expectedDbId,'db2');
  assert.deepEqual(submitted.filters,[{column:'uid',operator:'eq',value:'Ab123456',negate:false}]);
});

test('an untrusted index hint never narrows a different SQL content predicate',async(t)=>{
  const previousDeno=globalThis.Deno,previousFetch=globalThis.fetch;
  const seen=[];
  globalThis.Deno={env:{get:name=>name==='LOC_SEARCH_INDEX_URL'?'https://index.example.test':
    name==='LOC_SEARCH_INDEX_SECRET'?secret:
    name==='LOC_SEARCH_INDEX_ENABLED'?'true':''}};
  globalThis.fetch=async(url,options)=>{
    seen.push(JSON.parse(options.body));
    return new Response(JSON.stringify({complete:true,hits:[{
      scopeId:'lo3rwang',dbId:'db1',entityType:'galaxy',uid:'Ab123456',
      globalUid:locGlobalUid({databaseId:'db1',scopeId:'lo3rwang',uid:'Ab123456'})
    }]}),{status:200});
  };
  t.after(()=>{globalThis.Deno=previousDeno;globalThis.fetch=previousFetch;});
  const query={kind:'query',operation:'select',schema:'silver',
    table:'lo3rwang_galaxy',columns:['uid','title'],filters:[],
    or:['content.contains."文化"'],indexHint:{scopeId:'lo3rwang',query:'痕跡'}};
  assert.equal(await withIndexedCandidates(query,{connection_alias:'db1'}),query);
  assert.equal(await federatedIndexedCandidates(query,[{databaseId:'db1'}]),null);
  assert.equal(seen.length,0,'mismatching hints must never query or restrict via the index');
});

test('a compound or negated search is never reduced to one FlexSearch keyword',async(t)=>{
  const previousDeno=globalThis.Deno,previousFetch=globalThis.fetch;
  const seen=[];
  globalThis.Deno={env:{get:name=>name==='LOC_SEARCH_INDEX_URL'?'https://index.example.test':
    name==='LOC_SEARCH_INDEX_SECRET'?secret:
    name==='LOC_SEARCH_INDEX_ENABLED'?'true':''}};
  globalThis.fetch=async(url,options)=>{
    seen.push(JSON.parse(options.body));
    return new Response(JSON.stringify({complete:true,hits:[{
      scopeId:'lo3rwang',dbId:'db1',entityType:'galaxy',uid:'Ab123456',
      globalUid:locGlobalUid({databaseId:'db1',scopeId:'lo3rwang',uid:'Ab123456'})
    }]}),{status:200});
  };
  t.after(()=>{globalThis.Deno=previousDeno;globalThis.fetch=previousFetch;});
  for(const expression of [
    'content.contains."文化",content.contains."痕跡"',
    'and(content.contains."文化",content.contains."痕跡")',
    'content.contains."文化"'
  ]){
    const query={kind:'query',operation:'select',schema:'silver',
      table:'lo3rwang_galaxy',columns:['uid','title'],filters:[],
      or:[expression],indexHint:{scopeId:'lo3rwang',query:'痕跡'}};
    assert.equal(await withIndexedCandidates(query,{connection_alias:'db1'}),query);
  }
  assert.equal(seen.length,0);
});

test('the exact required content term still uses one FlexSearch candidate lookup',async(t)=>{
  const previousDeno=globalThis.Deno,previousFetch=globalThis.fetch;
  let calls=0;
  globalThis.Deno={env:{get:name=>name==='LOC_SEARCH_INDEX_URL'?'https://index.example.test':
    name==='LOC_SEARCH_INDEX_SECRET'?secret:
    name==='LOC_SEARCH_INDEX_ENABLED'?'true':''}};
  globalThis.fetch=async()=>{
    calls++;
    return new Response(JSON.stringify({complete:true,hits:[{
      scopeId:'lo3rwang',dbId:'db1',entityType:'galaxy',uid:'Ab123456',
      globalUid:locGlobalUid({databaseId:'db1',scopeId:'lo3rwang',uid:'Ab123456'})
    }]}),{status:200});
  };
  t.after(()=>{globalThis.Deno=previousDeno;globalThis.fetch=previousFetch;});
  const query={kind:'query',operation:'select',schema:'silver',
    table:'lo3rwang_galaxy',columns:['uid','title'],filters:[],
    or:['content.contains."文化"'],indexHint:{scopeId:'lo3rwang',query:'文化'}};
  const narrowed=await withIndexedCandidates(query,{connection_alias:'db1'});
  assert.deepEqual(narrowed.filters,[{column:'uid',operator:'in',value:['Ab123456']}]);
  assert.equal(calls,1);
});

