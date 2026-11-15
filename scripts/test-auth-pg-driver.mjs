// Tests LOC Auth pg/TCP lifecycle without any database credentials.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuthPostgresPool} from '../services/workers/loc-authority/pg-driver.mjs';

test('Auth pg dialect acquires a fresh TLS client and releases it',async()=>{
  const clients=[];
  class FakeClient{
    constructor(options){this.options=options;this.ended=false;clients.push(this)}
    on(){}
    async connect(){}
    async end(){this.ended=true}
  }
  const pool=createAuthPostgresPool(
    'postgresql://auth-user:password@postgres.example.test/auth',FakeClient,
    {attempts:1,delayMs:0});
  const first=await pool.connect();
  assert.equal(first.options.connectionTimeoutMillis,3500);
  assert.deepEqual(first.options.ssl,{rejectUnauthorized:true});
  first.release();
  await Promise.resolve();
  const second=await pool.connect();
  second.release();
  await Promise.resolve();
  assert.notEqual(first,second);
  assert.equal(first.ended,true);
  assert.equal(second.ended,true);
  assert.equal(clients.length,2);
  await pool.end();
});

test('Auth pg retries connect only, then returns the successful client',async()=>{
  let attempts=0;
  class FakeClient{
    constructor(){this.ended=false}
    on(){}
    async connect(){
      attempts++;
      if(attempts===1)throw Error('compute waking');
    }
    async end(){this.ended=true}
  }
  const pool=createAuthPostgresPool('postgres://host/auth',FakeClient,
    {attempts:2,delayMs:0});
  const client=await pool.connect();
  assert.equal(attempts,2);
  client.release();
  await Promise.resolve();
  assert.equal(client.ended,true);
});

test('Auth pg propagates failed connection without changing database',async()=>{
  let attempts=0;
  class FailedClient{
    on(){}
    async connect(){attempts++;throw Error('connect failed')}
    async end(){}
  }
  const pool=createAuthPostgresPool('postgres://host/auth',FailedClient,
    {attempts:2,delayMs:0});
  await assert.rejects(pool.connect(),/connect failed/);
  assert.equal(attempts,2);
});
