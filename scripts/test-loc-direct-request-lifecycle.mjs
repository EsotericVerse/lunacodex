import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createKyselyPublicClient} from '../app/loc/providers/kysely-browser.mjs';
import {cachedRead,invalidateCachedRead} from '../app/loc/db/semi-dynamic-cache.mjs';
import {cancelTransientReads} from '../packages/zenstack/transient-read-epoch.mjs';

const fakeClient=()=>{
  const calls=[];
  const fetch=async (url,options)=>{
    calls.push({url,options});
    await Promise.resolve();
    return new Response(JSON.stringify({data:[{uid:'ABCDEFGH'}],count:1}),{
      status:200,headers:{'content-type':'application/json','cache-control':'no-store'}
    });
  };
  return {client:createKyselyPublicClient({fetch}),calls};
};

test('anonymous direct SELECT shares pending request but not completed no-store results',async()=>{
  const {client,calls}=fakeClient();
  const query=()=>client.schema('silver').from('lo3rwang_galaxy')
    .select('uid').eq('uid','ABCDEFGH').limit(1);
  const [first,second]=await Promise.all([query(),query()]);
  assert.equal(calls.length,1);
  assert.deepEqual(first,second);
  assert.equal(calls[0].options.cache,'no-store');
  assert.equal(calls[0].options.credentials,'omit');
  assert.equal(calls[0].options.method,'POST');
  await query();
  assert.equal(calls.length,2,'a completed private-sensitive query cannot be a persistent HTTP cache');
  cancelTransientReads();
});

test('different selectors and explicit cancellation never share a request',async()=>{
  const {client,calls}=fakeClient();
  const query=(id,signal)=>client.schema('silver').from('lo3rwang_galaxy')
    .select('uid').eq('uid',id).abortSignal(signal).limit(1);
  const a=new AbortController(),b=new AbortController();
  await Promise.all([query('ABCDEFGH',a.signal),query('ABCDEFGH',b.signal),
    query('HGFEDCBA',undefined)]);
  assert.equal(calls.length,3);
  cancelTransientReads();
});

test('public analytics and fixed read actions reuse only pending identical calls',async()=>{
  const {client,calls}=fakeClient();
  const analytics=()=>client.schema('silver').analytics({
    p_view:'daily_total',p_scope_id:'lo3rwang',
    p_start:'2026-01-01',p_end:'2026-01-31'
  });
  await Promise.all([analytics(),analytics()]);
  assert.equal(calls.length,1);
  assert.equal(calls[0].options.method,'GET');
  await analytics();
  assert.equal(calls.length,2);
  await Promise.all([
    client.schema('silver').publicAction('block_list',{p_scope_id:'lo3rwang'}),
    client.schema('silver').publicAction('block_list',{p_scope_id:'lo3rwang'})
  ]);
  assert.equal(calls.length,3);
  cancelTransientReads();
});

test('semi-dynamic cached reads deduplicate and re-read only after explicit invalidation',async()=>{
  const key='test-direct-lifecycle:shared';
  let calls=0;
  const fetcher=async()=>({version:++calls});
  const [a,b]=await Promise.all([cachedRead(key,fetcher),cachedRead(key,fetcher)]);
  assert.equal(calls,1);
  assert.equal(a,b);
  await cachedRead(key,fetcher);
  assert.equal(calls,1);
  invalidateCachedRead(key);
  const latest=await cachedRead(key,fetcher);
  assert.equal(latest.version,2);
  invalidateCachedRead(key);
});

test('a failed outdated read never evicts a newer cached value',async()=>{
  const key='test-direct-lifecycle:race';
  let failOld;
  const old=cachedRead(key,()=>new Promise((_,reject)=>{failOld=reject;}));
  await Promise.resolve();
  invalidateCachedRead(key);
  let loaded=0;
  const newer=await cachedRead(key,async()=>({version:++loaded}));
  failOld(Error('old network failed'));
  await assert.rejects(old,/old network failed/);
  assert.equal(await cachedRead(key,async()=>({version:99})),newer);
  assert.equal(loaded,1);
  invalidateCachedRead(key);
});

test('failed config read can show published fallback but is retried later',async()=>{
  const source=readFileSync(new URL('../app/loc/scope/scope-data.js',import.meta.url),'utf8');
  assert.match(source,/return cachedRead\('scope-config:'\+scope\.id,[\s\S]*?\)\s*\.then\(data=>data\|\|publishedConfig\(scope\.id\)\)\s*\.catch\(\(\)=>publishedConfig\(scope\.id\)\)/);
  const key='test-direct-lifecycle:config';
  let attempts=0;
  const load=()=>cachedRead(key,async()=>{
    attempts++;
    if(attempts===1)throw Error('offline');
    return {live:true};
  }).catch(()=>({published:true}));
  assert.deepEqual(await load(),{published:true});
  assert.deepEqual(await load(),{live:true});
  assert.equal(attempts,2);
  invalidateCachedRead(key);
});
