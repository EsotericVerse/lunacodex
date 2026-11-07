import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveRuntimeDatabase} from '../app/loc/gateway/runtime-database-target.mjs';

const token='a.b.c',serviceKey='S'.repeat(43);
test('no selected database leaves anonymous/default routing unchanged',async()=>{
 const result=await resolveRuntimeDatabase({sub:'loc_'+'A'.repeat(40)},token,{
  fetchImpl:()=>{throw Error('No network fetch should run');}});
 assert.equal(result,null);
});
test('a signed selected SQL Server profile resolves without deploying new code',async()=>{
 let calls=0,seen=null;
 const selected={db_target:'azure_test',sub:'loc_'+'B'.repeat(40)};
 const result=await resolveRuntimeDatabase(selected,token,{
  serviceKey,now:1,
  fetchImpl:async (_url,request)=>{
   calls++;seen=request;
   return {ok:true,json:async()=>({id:'azure_test',profile:{
    engine:'mssql',host:'db.example.org',port:1433,
    database:'loc',username:'reader',password:'not-real'
   }})};
  }
 });
 assert.equal(result.target.engine,'mssql');
 assert.equal(result.target.connection_alias,'azure_test');
 assert.equal(new URL(result.profile.url).protocol,'mssql:');
 assert.equal(JSON.parse(seen.body).id,'azure_test');
 assert.equal(seen.headers.authorization,'Bearer '+token);
 assert.equal(calls,1);
 await resolveRuntimeDatabase(selected,token,{serviceKey,now:2,
  fetchImpl:()=>{throw Error('second call should reuse briefly cached profile')}});
});
test('unsigned DB names, absent service key and untrusted profile fail closed',async()=>{
 const claim={db_target:'test',sub:'loc_'+'C'.repeat(40)};
 await assert.rejects(resolveRuntimeDatabase(claim,'unsigned',{serviceKey}),/Signed LOC/);
 await assert.rejects(resolveRuntimeDatabase(claim,token,{serviceKey:''}),/service credential/);
 await assert.rejects(resolveRuntimeDatabase(claim,token,{serviceKey,
  fetchImpl:async()=>({ok:false,status:403})}),error=>error.httpStatus===403);
});
