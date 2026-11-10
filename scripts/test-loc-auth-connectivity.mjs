import test from 'node:test';
import assert from 'node:assert/strict';
import {testLocAuthConnection} from '../functions/api/loc-auth-connectivity.js';
const env={LOC_DATABASE_URI:'postgresql://test:secret@db.example.test:6543/postgres'};
test('Neon-ready Kysely Galaxy probe reads a real LOC relation without publishing UID',async()=>{
 const calls=[];
 const response=await testLocAuthConnection(env,async(_env,id)=>{
  assert.equal(id,'loc-main');
  return {engine:'postgres',db:{selectFrom(table){
   assert.equal(table,'silver.lo3rwang_galaxy');
   return {select(fields){calls.push(fields);return this},
    limit(n){calls.push(n);return this},
    async executeTakeFirst(){return {uid:'UNEXPOSED'}}};
  }}};
 });
 assert.equal(response.status,200);
 const result=await response.json();
 assert.equal(result.ok,true);
 assert.equal(result.rowFound,true);
 assert.equal(result.table,'lo3rwang_galaxy');
 assert.equal(result.data,undefined);
 assert.ok(!JSON.stringify(result).includes('UNEXPOSED'));
 assert.deepEqual(calls,['uid',1]);
});
test('missing deployment secret is reported without making a request',async()=>{
 const response=await testLocAuthConnection({},async()=>{
  throw Error('must not execute');
 });
 assert.equal(response.status,503);
 assert.equal((await response.json()).code,'LOC_DATABASE_URI_MISSING');
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
