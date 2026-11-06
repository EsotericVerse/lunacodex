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

test('a waiting cancelled read rejects immediately and never runs',async()=>{
  const budget=createPublicReadBudget(1);
  let release;
  const gate=new Promise(resolve=>{release=resolve});
  const occupied=budget(async()=>gate);
  const controller=new AbortController();
  let ran=false;
  const queued=budget(async()=>{ran=true;},controller.signal);
  const rejection=assert.rejects(queued,error=>error?.name==='AbortError');
  controller.abort();
  // This must settle while the first request still owns the slot.
  await rejection;
  assert.equal(ran,false);
  const following=budget(async()=>42);
  release();
  await occupied;
  assert.equal(await following,42);
  assert.equal(ran,false);
});

test('already aborted requests never consume a free read slot',async()=>{
  const budget=createPublicReadBudget(1);
  const controller=new AbortController();
  controller.abort();
  await assert.rejects(
    budget(async()=>{throw Error('should not run')},controller.signal),
    error=>error?.name==='AbortError'
  );
  assert.equal(await budget(async()=>7),7);
});

test('cancelled queued gateway query settles before active requests release',async()=>{
  let fetches=0,release;
  const gate=new Promise(resolve=>{release=resolve});
  const client=createKyselyEdgeClient({
    url:'https://demo.supabase.co',publishableKey:'public-key',role:'anon',
    fetch:async()=>{
      fetches++;
      await gate;
      return new Response(JSON.stringify({data:[]}),{
        status:200,headers:{'content-type':'application/json'}
      });
    }
  });
  const active=Array.from({length:3},()=>Promise.resolve(
    client.schema('silver').from('lo3rwang_galaxy').select('uid')));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(fetches,3);
  const signal=new AbortController();
  const queued=Promise.resolve(client.schema('silver').from('lo3rwang_galaxy')
    .select('uid').abortSignal(signal.signal));
  const rejection=assert.rejects(queued,error=>error?.name==='AbortError');
  signal.abort();
  await rejection;
  assert.equal(fetches,3);
  release();
  await Promise.all(active);
});
