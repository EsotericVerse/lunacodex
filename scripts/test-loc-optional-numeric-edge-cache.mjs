import assert from 'node:assert/strict';
import {withOptionalNumericEdgeCache} from '../app/loc/server/optional-numeric-edge-cache.mjs';

const base='https://loc.example/api/loc-public-content?kind=daily_total&scope=lo3rwang&start=2026-01-01&end=2026-12-31';
const sample=()=>new Response(JSON.stringify({data:{rows:[{day:'2026-11-14',item_count:2}]}}),{
  status:200,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}
});
const releaseA='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const releaseB='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const store=new Map();
const calls={match:0,put:0,read:0};
const cache={
  async match(key){calls.match++;return store.get(String(key))?.clone()},
  async put(key,response){calls.put++;store.set(String(key),response.clone())}
};
const previous=globalThis.caches;
globalThis.caches={default:cache};
const pending=[];
const context=(url=base,env={LOC_NUMERIC_EDGE_CACHE:'1',CF_PAGES_COMMIT_SHA:releaseA},headers={})=>({
  env,request:new Request(url,{headers}),
  waitUntil:promise=>{pending.push(promise)}
});
const read=async()=>{calls.read++;return sample()};
const run=async ctx=>withOptionalNumericEdgeCache(ctx,read);
const drain=async()=>{await Promise.all(pending.splice(0))};
try{
  // OFF means no cache match, no write, no extra calls to the SQL reader.
  let value=await run(context(base,{}));
  assert.equal(value.headers.get('cache-control'),'no-store');
  assert.deepEqual(calls,{match:0,put:0,read:1});

  value=await run(context());
  assert.equal(value.status,200);
  await drain();
  assert.deepEqual(calls,{match:1,put:1,read:2});
  assert.match(store.values().next().value.headers.get('cache-control'),/max-age=60/);
  assert.equal(value.headers.get('cache-control'),'no-store');

  // Same public query in a different parameter order is the same key.
  value=await run(context('https://loc.example/api/loc-public-content?end=2026-12-31&scope=lo3rwang&start=2026-01-01&kind=daily_total'));
  assert.equal(value.headers.get('x-loc-numeric-edge'),'HIT');
  assert.equal(value.headers.get('cache-control'),'no-store');
  assert.equal(calls.read,2);

  // A different deployment must never inherit an old numeric response.
  value=await run(context(base,{LOC_NUMERIC_EDGE_CACHE:'1',CF_PAGES_COMMIT_SHA:releaseB}));
  await drain();
  assert.equal(calls.read,3);
  assert.equal(value.headers.get('x-loc-numeric-edge'),null);

  // Bypass requests must never inspect the cache or store private responses.
  const bypass=[
    context(base,{}),
    context(base,{LOC_NUMERIC_EDGE_CACHE:'1'}, {Authorization:'Bearer token'}),
    context(base,{LOC_NUMERIC_EDGE_CACHE:'1'}, {Cookie:'session=x'}),
    context(base,{LOC_NUMERIC_EDGE_CACHE:'1'}, {Range:'bytes=0-10'}),
    context(base.replace('kind=daily_total','kind=config')),
    context(base.replace('kind=daily_total','kind=earliest')),
    context(base.replace('scope=lo3rwang','scope=private')),
    context(base+'&extra=secret'),
    context(base+'&kind=daily_total'),
    {...context(),waitUntil:null}
  ];
  const before={...calls};
  for(const ctx of bypass){
    value=await run(ctx);
    assert.equal(value.status,200);
  }
  assert.equal(calls.match,before.match);
  assert.equal(calls.put,before.put);
  assert.equal(calls.read,before.read+bypass.length);

  // Failed cache lookup is a single live read, not a 503 to the browser.
  cache.match=async()=>{calls.match++;throw new Error('Edge cache unavailable')};
  const startReads=calls.read;
  value=await run(context());
  assert.equal(value.status,200);
  assert.equal(calls.read,startReads+1);
  cache.match=async key=>{calls.match++;return store.get(String(key))?.clone()};

  // Only 200 JSON responses without cookies are eligible for storage.
  const skipCases=[
    new Response(JSON.stringify({error:'unavailable'}),{status:503,headers:{'content-type':'application/json'}}),
    new Response('text',{status:200,headers:{'content-type':'text/plain'}}),
    new Response('{}',{status:200,headers:{'content-type':'application/json','set-cookie':'x=y'}})
  ];
  const beforePuts=calls.put;
  for(let i=0;i<skipCases.length;i++)
    await withOptionalNumericEdgeCache(context(base.replace('2026-01-01',`2026-0${i+2}-01`)),()=>Promise.resolve(skipCases[i]));
  await drain();
  assert.equal(calls.put,beforePuts);

  // Failure to store a snapshot cannot fail or slow the caller.
  cache.put=async()=>{calls.put++;throw new Error('Unwritable edge cache')};
  value=await run(context(base.replace('2026-01-01','2026-05-01')));
  assert.equal(value.status,200);
  await drain();

  // Turning the flag OFF after having cached a query bypasses even a HIT.
  const previousMatches=calls.match;
  await run(context(base,{}));
  assert.equal(calls.match,previousMatches);
  console.log('LOC optional numeric edge cache: 15 safety/fallback scenarios PASS');
}finally{
  if(previous===undefined)delete globalThis.caches;
  else globalThis.caches=previous;
}
