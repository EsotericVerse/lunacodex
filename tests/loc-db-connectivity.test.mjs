import {test} from 'node:test';
import assert from 'node:assert/strict';
import {testLocAuthConnection} from '../functions/api/loc-auth-connectivity.js';

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
