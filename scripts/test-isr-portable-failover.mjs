import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {isAvailabilityFailure,tryPublicSources} from '../app/api/loc/_numeric-failover.mjs';

test('ISR retries only availability failures using an independent SQL Gateway',async()=>{
  const calls=[];
  const candidates=['primary','backup'].map(id=>({id,schema:()=>({id})}));
  const result=await tryPublicSources(candidates,async schema=>{
    calls.push(schema.id);
    return schema.id==='primary'?{retryable:true,error:'SQL transport unavailable'}:
      {data:{rows:[{day:'2026-11-07',total:12}]}};
  });
  assert.deepEqual(calls,['primary','backup']);
  assert.equal(result.source,'backup');
  assert.equal(result.data.rows[0].total,12);
});

test('validation, permission and disabled-ISR outcomes never fail over',async()=>{
  const candidates=['primary','backup'].map(id=>({id,schema:()=>({id})}));
  for(const bad of [{disabled:true,error:'ISR disabled'}, {retryable:false,error:'Invalid parameters'}]){
    const calls=[];
    const value=await tryPublicSources(candidates,async schema=>{calls.push(schema.id);return bad});
    assert.deepEqual(calls,['primary']);
    assert.equal(value.source,'primary');
  }
  assert.equal(isAvailabilityFailure({status:401,error:{message:'Unauthorized'}}),false);
  assert.equal(isAvailabilityFailure({status:403,error:{message:'Forbidden'}}),false);
  assert.equal(isAvailabilityFailure({status:503,error:{message:'Gateway unavailable'}}),true);
});

test('ISR transport never requests Neon or Supabase Auth tokens',()=>{
  const src=readFileSync(new URL('../app/api/loc/_server.js',import.meta.url),'utf8');
  assert.match(src,/LOC_BACKUP_SQL_GATEWAY_URL/);
  assert.doesNotMatch(src,/NEON_AUTH_URL|token\/anonymous|PostgrestClient|createBackupPublicAdapter/);
});
