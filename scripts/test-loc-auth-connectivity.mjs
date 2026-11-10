import test from 'node:test';
import assert from 'node:assert/strict';
import {testLocAuthConnection} from '../functions/api/loc-auth-connectivity.js';
const env={LOC_DATABASE_URL:'postgresql://test:secret@db.example.test:6543/postgres'};
test('test table query runs through selected Kysely connection',async()=>{
 const calls=[];
 const response=await testLocAuthConnection(env,async(_env,id)=>{
  assert.equal(id,'loc-main');
  return {engine:'postgres',db:{selectFrom(table){
   assert.equal(table,'silver.loc_auth');
   return {select(fields){calls.push(fields);return this},
    where(...terms){calls.push(terms);return this},
    async executeTakeFirst(){return {uid:'001',email:'owner@example.test',
     scopeid:'lo3rwang',role:'admin'}}};
  }}};
 });
 assert.equal(response.status,200);
 const result=await response.json();
 assert.equal(result.ok,true);
 assert.equal(result.data.uid,'001');
 assert.deepEqual(calls[1],['uid','=','001']);
});
test('missing deployment secret is reported without making a request',async()=>{
 const response=await testLocAuthConnection({},async()=>{
  throw Error('must not execute');
 });
 assert.equal(response.status,503);
 assert.equal((await response.json()).code,'LOC_DATABASE_URL_MISSING');
});
test('SQL auth error is categorized without leaking credentials',async()=>{
 const response=await testLocAuthConnection(env,async()=>{
  throw new Error('password authentication failed with secret-for-test');
 });
 assert.equal(response.status,503);
 const r=await response.json();
 assert.equal(r.reason,'DB_AUTH');
 assert.ok(!JSON.stringify(r).includes('secret-for-test'));
});
