// Run with: node --test scripts/test-postgres-direct-connectivity.mjs
// Contract checks use injected clients and never require database credentials.
// A successful LIVE probe still requires calling the deployed
// /api/loc-auth-connectivity endpoint from outside the application.
import test from 'node:test';
import assert from 'node:assert/strict';
import {db_connection,requestScopedPool}
  from '../app/loc/mcp/native-kysely.mjs';
import {testLocAuthConnection}
  from '../functions/api/loc-auth-connectivity.js';

test('PostgreSQL client accepts an ordinary non-Neon TCP URI',async()=>{
  const configured=await db_connection({
    LOC_DATABASE_URI:'postgresql://loc_reader:password@postgres.example.com:5432/lunacodex'
  },'loc-main');
  assert.equal(configured.engine,'postgres');
  assert.equal(configured.namespace,'silver');
  assert.equal(typeof configured.db.selectNoFrom,'function');
  await assert.rejects(
    db_connection({LOC_DATABASE_URI:'https://example.com/api'},'loc-main'),
    /PostgreSQL URI/);
});

test('native pg Client is fresh per acquisition and released',async()=>{
  const clients=[];
  class FakePgClient{
    constructor(options){this.options=options;this.ended=false;clients.push(this);}
    on(){}
    async connect(){}
    async end(){this.ended=true;}
  }
  const pool=requestScopedPool({connectionString:'postgres://example.invalid/test'},
    FakePgClient,{attempts:1,baseDelayMs:0});
  const first=await pool.connect();
  first.release();
  await Promise.resolve();
  const second=await pool.connect();
  second.release();
  await Promise.resolve();
  assert.notEqual(first,second);
  assert.equal(first.ended,true);
  assert.equal(second.ended,true);
  assert.equal(clients.length,2);
});

test('release() extends the request via waitUntil when one is set',async()=>{
  let ended=false;
  class FakePgClient{
    on(){}
    async connect(){}
    async end(){await Promise.resolve();ended=true;}
  }
  const pool=requestScopedPool({connectionString:'postgres://example.invalid/test'},
    FakePgClient,{attempts:1,baseDelayMs:0});
  const waited=[];
  pool.setWaitUntil(promise=>waited.push(promise));
  const client=await pool.connect();
  client.release();
  assert.equal(waited.length,1,'release() must hand its close promise to waitUntil');
  assert.equal(ended,false,'close is still in flight synchronously after release()');
  await waited[0];
  assert.equal(ended,true,'awaiting the handed-off promise lets the close finish');
});

test('release() still closes the client with no waitUntil set (unchanged default)',async()=>{
  let ended=false;
  class FakePgClient{
    on(){}
    async connect(){}
    async end(){ended=true;}
  }
  const pool=requestScopedPool({connectionString:'postgres://example.invalid/test'},
    FakePgClient,{attempts:1,baseDelayMs:0});
  const client=await pool.connect();
  client.release();
  await Promise.resolve();await Promise.resolve();
  assert.equal(ended,true);
});

test('db_connection points a cached/reused pool at the current request\'s waitUntil',async()=>{
  const env={LOC_DATABASE_URI:'postgresql://loc_reader:password@postgres.example.com:5432/lunacodex'};
  const first=await db_connection(env,'loc-main',{waitUntil:()=>{}});
  const seenByFirst=[];
  first.pool.setWaitUntil=original=>{seenByFirst.push(original);};
  const marker=()=>{};
  await db_connection(env,'loc-main',{waitUntil:marker});
  assert.equal(seenByFirst[0],marker,
    'reusing the cached connection must re-point release() at the new caller\'s waitUntil, not the one captured when the pool was first built');
});

test('healthy direct PostgreSQL connection needs no Galaxy rows',async()=>{
  let calls=0;
  const response=await testLocAuthConnection(
    {LOC_DATABASE_URI:'postgres://credentials-not-echoed'},
    async(_env,alias)=>{
      assert.equal(alias,'loc-main');
      return {engine:'postgres',db:{
        selectNoFrom(expression){
          calls++;
          const value=expression({val:n=>({as:key=>({n,key})})});
          assert.deepEqual(value,{n:1,key:'connected'});
          return {executeTakeFirstOrThrow:async()=>({connected:1})};
        }
      }};
    });
  assert.equal(calls,1);
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{
    ok:true,connection:'postgresql',driver:'pg',probe:'select_1'
  });
});

test('missing PostgreSQL credentials are not reported as connected',async()=>{
  const response=await testLocAuthConnection({},async()=>{
    throw Error('Connection must not be attempted without credentials');
  });
  assert.equal(response.status,503);
  assert.equal((await response.json()).code,'LOC_DATABASE_URI_MISSING');
});

test('a bad SQL probe cannot be mistaken for a live connection',async()=>{
  const response=await testLocAuthConnection(
    {LOC_DATABASE_URI:'postgres://credentials-not-echoed'},
    async()=>({engine:'postgres',db:{
      selectNoFrom:()=>({executeTakeFirstOrThrow:async()=>({connected:0})})
    }}));
  assert.equal(response.status,503);
  assert.equal((await response.json()).code,'PG_PROBE_INVALID');
});
