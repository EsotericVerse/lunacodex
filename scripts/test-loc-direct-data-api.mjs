import test from 'node:test';
import assert from 'node:assert/strict';
import {createConfiguredAdapter} from '../app/loc/providers/configured.mjs';
import {createDirectDataApiClient} from '../app/loc/providers/direct-data-api.mjs';

test('static LOC public reads use existing Data API, never an SQL proxy',async()=>{
  const calls=[];
  const response=async (url,options)=>{calls.push({url:String(url),options});
    return new Response(JSON.stringify([{uid:'abcd1234',title:'公開'}]),{
      status:200,headers:{'content-type':'application/json','content-range':'0-0/1'}});};
  const api=createDirectDataApiClient({url:'https://example.net/rest/v1',
    apiKey:'public_key',fetch:response});
  const result=await api.schema('silver').from('lo3rwang_galaxy')
    .select('uid,title').eq('uid','abcd1234').limit(1);
  assert.equal(result.data[0].uid,'abcd1234');
  assert.match(calls[0].url,/example.net\/rest\/v1\/lo3rwang_galaxy/);
  assert.equal(calls[0].options.headers['accept-profile'],'silver');
  assert.equal(new URL(calls[0].url).searchParams.get('search'),'eq.true');
  assert.ok(!calls[0].url.includes('gateway'));
});
test('public article body requires list=true',async()=>{
  let actual;
  const api=createDirectDataApiClient({url:'https://example.net/rest/v1',apiKey:'public',
    fetch:async u=>{actual=new URL(u);return new Response('[]',{status:200})}});
  await api.schema('silver').from('lo3rwang_galaxy').select('uid,content');
  assert.equal(actual.searchParams.get('search'),'eq.true');
  assert.equal(actual.searchParams.get('list'),'eq.true');
});
test('public API never executes writes with browser public key',()=>{
  const identity={auth:{},getAccessToken:async()=>''};
  const adapter=createConfiguredAdapter({accountAdapter:identity,fetchImpl:async()=>{throw Error('fetch unavailable')}});
  assert.throws(()=>adapter.authClient.schema('silver').from('loc').insert([]),/owner Web Server/);
});
