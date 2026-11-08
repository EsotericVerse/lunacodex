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

test('Culture Anchors use the existing public Data API without an application endpoint',async()=>{
  const calls=[];
  const api=createDirectDataApiClient({url:'https://example.net/rest/v1',apiKey:'public',
    fetch:async(input,options)=>{
      calls.push({url:String(input),options});
      return new Response(JSON.stringify([{uid:'Ab12Cd34',type:'era',title:'時代',
        attr:{period:['Bc23De45']}}]),{status:200});
    }});
  const result=await api.schema('silver').analytics({p_scope_id:'lo3rwang',
    p_view:'culture_anchors'});
  assert.equal(result.data[0].uid,'Ab12Cd34');
  assert.equal(calls.length,1);
  const uri=new URL(calls[0].url);
  assert.equal(uri.pathname,'/rest/v1/lo3rwang_anchor');
  assert.equal(uri.searchParams.get('invisible'),'eq.false');
  assert.equal(calls[0].options.headers['accept-profile'],'silver');
  assert.equal(calls[0].options.credentials,'omit');
});
test('Culture density requests a database-side daily grouped aggregate',async()=>{
  const calls=[];
  const api=createDirectDataApiClient({url:'https://example.net/rest/v1',apiKey:'public',
    fetch:async(input)=>{
      calls.push(String(input));
      return new Response(JSON.stringify([{date:'2026-11-08',site:'threads',count:3}]),
        {status:200});
    }});
  const result=await api.schema('silver').analytics({p_scope_id:'lo3rwang',
    p_view:'culture_density',p_start:'2025-11-08',p_end:'2026-11-08'});
  assert.deepEqual(result.data,[{day:'2026-11-08',site:'threads',item_count:3}]);
  const uri=new URL(calls[0]);
  assert.equal(uri.pathname,'/rest/v1/lo3rwang_galaxy');
  assert.equal(uri.searchParams.get('select'),'date,site,count()');
  assert.equal(uri.searchParams.get('culture'),'eq.true');
  assert.equal(uri.searchParams.get('search'),null);
  assert.equal(uri.searchParams.getAll('date').length,2);
});
test('Culture list does not silently require the unrelated Search flag',async()=>{
  let uri;
  const api=createDirectDataApiClient({url:'https://example.net/rest/v1',apiKey:'public',
    fetch:async(input)=>{uri=new URL(input);return new Response('[]',{status:200});}});
  await api.schema('silver').from('lo3rwang_galaxy').select('uid,date,title,list')
    .eq('culture',true).gte('date','2026-11-01').lte('date','2026-11-08')
    .eq('site','threads').order('createtime',{ascending:false}).limit(100);
  assert.equal(uri.searchParams.get('search'),null);
  assert.equal(uri.searchParams.get('culture'),'eq.true');
  assert.equal(uri.searchParams.get('limit'),'100');
});
test('Culture rejects malformed dates before any database request',async()=>{
  let calls=0;
  const api=createDirectDataApiClient({url:'https://example.net/rest/v1',apiKey:'public',
    fetch:async()=>{calls++;throw Error('unexpected network call');}});
  await assert.rejects(api.schema('silver').analytics({p_scope_id:'lo3rwang',
    p_view:'culture_density',p_start:'invalid',p_end:'2026-11-08'}),
    /Invalid LOC Culture query/);
  assert.equal(calls,0);
});
