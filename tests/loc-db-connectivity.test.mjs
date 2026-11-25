import {test} from 'node:test';
import assert from 'node:assert/strict';
import {testLocAuthConnection} from '../app/loc/db/native-connectivity-check.mjs';
import {requestScopedPool} from '../modules/loc/dialect/index.mjs';
import {closeLocDatabase,bindLocRequestAbort} from '../app/loc/mcp/native-kysely.mjs';

const body=async response=>JSON.parse(await response.text());

test('missing LOC_DATABASE_URI fails before opening a connection',async()=>{
  let connected=false;
  const response=await testLocAuthConnection({},async()=>{
    connected=true;
    throw Error('The PostgreSQL driver must not be called without a URI');
  });
  assert.equal(response.status,503);
  assert.deepEqual(await body(response),{
    ok:false,stage:'configuration',code:'LOC_DATABASE_URI_MISSING'
  });
  assert.equal(connected,false);
});

test('a SQL connection failure never returns the URI or error text to the browser',async()=>{
  const sensitive='postgresql://sensitive-user:secret-password@private-neon-host/database';
  const response=await testLocAuthConnection({LOC_DATABASE_URI:sensitive},async()=>{
    throw Object.assign(new Error('failed to connect '+sensitive),{code:'ECONNREFUSED'});
  });
  const result=await response.text();
  assert.equal(response.status,503);
  assert.equal(JSON.parse(result).reason,'TRANSPORT');
  assert.ok(!result.includes('sensitive-user'));
  assert.ok(!result.includes('secret-password'));
  assert.ok(!result.includes('private-neon-host'));
});

class TestSqlClient{
  static all=[];
  constructor(){this.connected=false;this.closed=0;TestSqlClient.all.push(this);}
  on(){}
  async connect(){this.connected=true;}
  async end(){this.closed++;}
}
test('request SQL pool reuses released clients and closes them at request end',async()=>{
  TestSqlClient.all=[];
  const lifecycle=[];
  const pool=requestScopedPool({},TestSqlClient,{attempts:1});
  pool.setWaitUntil(job=>{lifecycle.push(job);});
  const client=await pool.connect();
  assert.equal(client.connected,true);
  client.release();
  assert.equal(client.closed,0);
  const reused=await pool.connect();
  assert.equal(reused,client);
  reused.release();
  await pool.end();
  await Promise.all(lifecycle);
  assert.equal(client.closed,1);
  await pool.end();
  assert.equal(client.closed,1);
});
test('request cancellation closes active connection and refuses future acquisition',async()=>{
  TestSqlClient.all=[];
  const pool=requestScopedPool({},TestSqlClient,{attempts:1});
  const client=await pool.connect();
  const controller=new AbortController();
  const release=bindLocRequestAbort({pool},controller.signal);
  controller.abort();
  await pool.end();
  release();
  assert.equal(client.closed,1);
  await assert.rejects(pool.connect(),/already closed/);
});

test('a failed connection attempt releases its socket before propagating failure',async()=>{
  class FailingClient extends TestSqlClient{
    async connect(){throw Error('simulated database unavailable');}
  }
  TestSqlClient.all=[];
  const pool=requestScopedPool({},FailingClient,{attempts:1});
  await assert.rejects(pool.connect(),/simulated database unavailable/);
  assert.equal(TestSqlClient.all.length,1);
  assert.equal(TestSqlClient.all[0].closed,1);
  await pool.end();
});

test('transient SQL resets retry within the connection budget',async()=>{
  let elapsed=0,tries=0,closed=0;
  const delays=[];
  class WakeClient{
    constructor(options){
      assert.ok(options.connectionTimeoutMillis>0);
    }
    on(){}
    async connect(){
      tries++;
      if(tries<5)throw Object.assign(new Error('temporary reset'),{code:'ECONNRESET'});
    }
    async end(){closed++;}
  }
  const pool=requestScopedPool({connectionTimeoutMillis:6000},WakeClient,{
    now:()=>elapsed,sleep:async ms=>{delays.push(ms);elapsed+=ms;}
  });
  const client=await pool.connect();
  assert.equal(tries,5);
  assert.ok(delays.every(ms=>ms>=0));
  assert.ok(elapsed<6000);
  client.release();
  await pool.end();
  assert.equal(closed,tries);
});
test('connection retries respect the total timeout budget',async()=>{
  let elapsed=0,tries=0,closed=0;
  class SlowClient{
    constructor(options){this.timeout=options.connectionTimeoutMillis;}
    on(){}
    async connect(){
      tries++;elapsed+=this.timeout;
      throw Object.assign(new Error('connection timeout'),{code:'ETIMEDOUT'});
    }
    async end(){closed++;}
  }
  const pool=requestScopedPool({connectionTimeoutMillis:6000},SlowClient,{
    now:()=>elapsed,sleep:async ms=>{elapsed+=ms;}
  });
  await assert.rejects(pool.connect(),/connection timeout/);
  assert.ok(tries>=1);
  assert.ok(elapsed<=6000);
  assert.equal(closed,tries);
  await pool.end();
});
test('invalid database credentials fail immediately without retrying',async()=>{
  let attempts=0;
  class InvalidClient{
    on(){}
    async connect(){attempts++;throw Object.assign(Error('denied'),{code:'28P01'});}
    async end(){}
  }
  const pool=requestScopedPool({},InvalidClient,{
    sleep:async()=>{throw Error('must not wait after permanent failure');}
  });
  await assert.rejects(pool.connect(),/denied/);
  assert.equal(attempts,1);
  await pool.end();
});
test('database owner closes its pool even if Kysely destruction fails',async()=>{
  const events=[];
  await assert.rejects(closeLocDatabase({
    db:{async destroy(){events.push('db');throw Error('forced destroy failure');}},
    pool:{async end(){events.push('pool');}}
  }),/forced destroy failure/);
  assert.deepEqual(events,['db','pool']);
});

