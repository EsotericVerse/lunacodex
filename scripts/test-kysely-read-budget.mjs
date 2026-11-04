import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublicReadBudget,MAX_PUBLIC_GATEWAY_READS} from '../app/loc/providers/kysely-read-budget.mjs';
import {createKyselyEdgeClient} from '../app/loc/providers/kysely-edge.mjs';

test('anonymous burst dispatch holds at most three concurrent reads',async()=>{
  assert.equal(MAX_PUBLIC_GATEWAY_READS,3);
  const budget=createPublicReadBudget();
  let active=0,peak=0,started=0;
  let release;
  const gate=new Promise(resolve=>{release=resolve});
  const reads=Array.from({length:9},(_,i)=>budget(async()=>{
    active++;started++;peak=Math.max(peak,active);
    await gate;
    active--;
    return i;
  }));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(started,3);
  release();
  assert.deepEqual(await Promise.all(reads),[0,1,2,3,4,5,6,7,8]);
  assert.equal(peak,3);
});

test('a failed read releases its reserved capacity',async()=>{
  const budget=createPublicReadBudget(1);
  const failed=budget(async()=>{throw new Error('upstream unavailable')});
  const recovered=budget(async()=>42);
  await assert.rejects(failed,/upstream unavailable/);
  assert.equal(await recovered,42);
});

test('a 503 SELECT makes one HTTP request, not an immediate retry',async()=>{
  let calls=0;
  const client=createKyselyEdgeClient({
    url:'https://demo.supabase.co',publishableKey:'public-key',
    role:'anon',fetch:async()=>{
      calls++;
      return new Response(JSON.stringify({error:{message:'DB temporarily unavailable'}}),
        {status:503,headers:{'content-type':'application/json'}});
    }
  });
  await assert.rejects(client.schema('silver').from('lo3rwang_galaxy').select('uid'),/temporarily unavailable/);
  assert.equal(calls,1);
});

test('authenticated managed operations bypass the anonymous read budget',async()=>{
  const budget=createPublicReadBudget(1);
  let release;
  const gate=new Promise(resolve=>{release=resolve});
  const held=budget(async()=>gate);
  let calls=0;
  const client=createKyselyEdgeClient({
    gatewayUrl:'https://sql.example/v1',role:'authenticated',
    getAccessToken:async()=> 'signed-token',
    fetch:async()=>{
      calls++;
      return new Response(JSON.stringify({data:{ok:true}}),{status:200,
        headers:{'content-type':'application/json'}});
    }
  });
  const result=await client.schema('silver').managedAction('manage',{p_type:'self'});
  assert.equal(result.data.ok,true);
  assert.equal(calls,1);
  release();
  await held;
});
