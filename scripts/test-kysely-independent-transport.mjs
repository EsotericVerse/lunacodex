import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createKyselyEdgeClient} from '../app/loc/providers/kysely-edge.mjs';

function fakeFetch(spy){
  return async (url,init)=>{
    spy.push({url,init});
    return new Response(JSON.stringify({data:[{uid:'aB12cD34'}],count:1}),
      {status:200,headers:{'content-type':'application/json'}});
  };
}
test('existing Supabase Kysely calls retain their endpoint and publishable header',async()=>{
  const spy=[];
  const client=createKyselyEdgeClient({
    url:'https://demo.supabase.co',publishableKey:'public-key',role:'anon',fetch:fakeFetch(spy)
  });
  const result=await client.schema('silver').from('runes').select('uid').limit(1);
  assert.ifError(result.error);
  assert.equal(spy[0].url,'https://demo.supabase.co/functions/v1/loc-kysely');
  assert.equal(spy[0].init.headers.apikey,'public-key');
  assert.equal(spy[0].init.credentials,'omit');
  assert.ok(spy[0].init.signal instanceof AbortSignal);
});
test('independent Kysely Gateway uses verified access-token callback without Supabase',async()=>{
  const spy=[];
  const client=createKyselyEdgeClient({
    gatewayUrl:'https://db-gateway.example/v1/sql',
    role:'authenticated',getAccessToken:async()=> 'trusted.jwt.token',fetch:fakeFetch(spy)
  });
  const result=await client.schema('silver').from('runes').select('uid').limit(1);
  assert.equal(result.data[0].uid,'aB12cD34');
  assert.equal(spy[0].url,'https://db-gateway.example/v1/sql');
  assert.equal(spy[0].init.headers.authorization,'Bearer trusted.jwt.token');
  assert.equal(spy[0].init.headers.apikey,undefined);
  assert.equal(spy[0].init.credentials,'omit');
});
test('Clerk managed writes use Kysely instead of the management SQL RPC',async()=>{
  const spy=[];
  const client=createKyselyEdgeClient({
    gatewayUrl:'https://db-gateway.example/v1/sql',
    role:'authenticated',getAccessToken:async()=> 'trusted.jwt.token',fetch:fakeFetch(spy)
  });
  const payload={p_table:'silver.lo3rwang_galaxy',p_operation:'update',
    p_values:{title:'Updated'},p_filters:[{column:'uid',operator:'eq',value:'aB12cD34'}]};
  const result=await client.schema('silver').managedWrite(payload);
  assert.ifError(result.error);
  assert.deepEqual(JSON.parse(spy[0].init.body),{kind:'managed-write',payload,target:'configured'});
  assert.equal(spy[0].init.headers.authorization,'Bearer trusted.jwt.token');
  assert.equal(spy[0].init.credentials,'omit');
});
test('Clerk actions route through the Kysely executor without database RPCs',async()=>{
  const spy=[];
  const client=createKyselyEdgeClient({gatewayUrl:'https://db-gateway.example/v1/sql',
    role:'authenticated',getAccessToken:async()=> 'trusted.jwt.token',fetch:fakeFetch(spy)});
  await client.schema('silver').managedAction('read_group_members',{p_group_id:'loc'});
  assert.deepEqual(JSON.parse(spy[0].init.body),{kind:'managed-action',
    name:'read_group_members',args:{p_group_id:'loc'},target:'configured'});
  assert.equal(spy[0].init.headers.authorization,'Bearer trusted.jwt.token');
});
test('SQL Gateway never sends unauthenticated private requests',async()=>{
  const spy=[];
  const client=createKyselyEdgeClient({
    gatewayUrl:'https://db-gateway.example/v1/sql',getAccessToken:async()=>'',fetch:fakeFetch(spy)
  });
  await assert.rejects(client.schema('silver').from('manage').select('id'),/active session/);
  assert.equal(spy.length,0);
});
test('gateway URL rejects non-TLS and embedded credentials',()=>{
  for(const url of ['http://db-gateway.example/v1','https://user:pass@db-gateway.example/v1',
    'https://db-gateway.example/v1?apikey=exposed','https://db-gateway.example/v1#secret']){
    assert.throws(()=>createKyselyEdgeClient({gatewayUrl:url,fetch:fakeFetch([])}),/HTTPS URL/);
  }
});
