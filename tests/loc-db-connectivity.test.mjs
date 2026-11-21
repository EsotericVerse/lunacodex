import {test} from 'node:test';
import assert from 'node:assert/strict';
import {testLocAuthConnection} from '../functions/api/loc-auth-connectivity.js';
import {requestScopedPool} from '../modules/loc/dialect/index.mjs';
import {closeLocDatabase,bindLocRequestAbort} from '../app/loc/mcp/native-kysely.mjs';
import {readFileSync} from 'node:fs';

const body=async response=>JSON.parse(await response.text());

test('a Pages Preview without LOC_DATABASE_URI reports configuration missing',async()=>{
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

test('an injected PostgreSQL connection performs one bounded SELECT 1 probe',async()=>{
  let calls=0;
  const response=await testLocAuthConnection(
    {LOC_DATABASE_URI:'configured-secret-not-inspected'},
    async()=>{
      calls++;
      return {engine:'postgres',db:{
        selectNoFrom(select){
          assert.equal(typeof select,'function');
          return {executeTakeFirstOrThrow:async()=>({connected:1})};
        }
      }};
    });
  assert.equal(calls,1);
  assert.equal(response.status,200);
  assert.deepEqual(await body(response),{
    ok:true,connection:'postgresql',driver:'pg',probe:'select_1'
  });
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
test('request SQL pool closes released connections exactly once',async()=>{
  TestSqlClient.all=[];
  const lifecycle=[];
  const pool=requestScopedPool({},TestSqlClient,{attempts:1});
  pool.setWaitUntil(job=>{lifecycle.push(job);});
  const client=await pool.connect();
  assert.equal(client.connected,true);
  client.release();
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
test('database owner closes its pool even if Kysely destruction fails',async()=>{
  const events=[];
  await assert.rejects(closeLocDatabase({
    db:{async destroy(){events.push('db');throw Error('forced destroy failure');}},
    pool:{async end(){events.push('pool');}}
  }),/forced destroy failure/);
  assert.deepEqual(events,['db','pool']);
});
test('LOC operation source contains one transaction and verified permission snapshot',()=>{
  const native=readFileSync(new URL('../app/loc/mcp/native-operations.mjs',import.meta.url),'utf8');
  const dock=readFileSync(new URL('../app/modular/edit-dock.jsx',import.meta.url),'utf8');
  assert.match(native,/verifiedRights=host===MCP_HOST/);
  assert.match(native,/readLocAccess\(trx,claims.email/);
  assert.match(native,/await selected\.db\.transaction\(\)\.execute\(async trx=>/);
  assert.match(native,/await closeLocDatabase\(selected\)/);
  assert.match(dock,/await transactionWrites\(operations\)/);
});
