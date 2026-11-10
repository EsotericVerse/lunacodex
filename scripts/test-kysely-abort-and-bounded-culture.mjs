import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createKyselyPublicClient} from '../app/loc/providers/kysely-browser.mjs';
import {mapBounded} from '../app/loc/bounded-parallel.mjs';

const ok=()=>new Response(JSON.stringify({data:[{uid:'aB12cD34'}]}),{
  status:200,headers:{'content-type':'application/json'}
});

test('already-cancelled anonymous query never opens HTTP',async()=>{
  let fetches=0;
  const controller=new AbortController();
  controller.abort();
  const db=createKyselyPublicClient({
    role:'anon',
    fetch:async()=>{fetches++;return ok()}
  });
  await assert.rejects(
    Promise.resolve(db.schema('silver').from('lo3rwang_galaxy').select('uid')
      .abortSignal(controller.signal)),
    error=>error?.name==='AbortError'
  );
  assert.equal(fetches,0);
});

test('in-flight query cancels its real HTTP fetch signal',async()=>{
  const controller=new AbortController();
  let started,signal;
  const entered=new Promise(resolve=>{started=resolve});
  const db=createKyselyPublicClient({
    role:'anon',
    fetch:async(_url,options)=>{
      signal=options.signal;
      return new Promise((_resolve,reject)=>{
        options.signal.addEventListener('abort',()=>{
          reject(Object.assign(new Error('fetch cancelled'),{name:'AbortError'}));
        },{once:true});
        started();
      });
    }
  });
  const running=Promise.resolve(db.schema('silver').from('lo3rwang_galaxy')
    .select('uid').abortSignal(controller.signal));
  await entered;
  const failure=assert.rejects(running,error=>error?.name==='AbortError');
  controller.abort();
  await failure;
  assert.equal(signal.aborted,true);
});

test('cancelled query waiting in the public budget never sends HTTP',async()=>{
  let release;
  const hold=new Promise(resolve=>{release=resolve});
  let fetches=0;
  const db=createKyselyPublicClient({
    role:'anon',
    fetch:async()=>{fetches++;await hold;return ok()}
  });
  const active=Array.from({length:3},()=>Promise.resolve(
    db.schema('silver').from('lo3rwang_galaxy').select('uid')));
  // Reserve all three anonymous HTTP lanes before queueing a fourth.
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(fetches,3);
  const controller=new AbortController();
  const queued=Promise.resolve(db.schema('silver').from('lo3rwang_galaxy')
    .select('uid').abortSignal(controller.signal));
  const failure=assert.rejects(queued,error=>error?.name==='AbortError');
  controller.abort();
  release();
  await Promise.all(active);
  await failure;
  assert.equal(fetches,3);
});

test('bounded multi-Scope reads preserve order and stop burst fan-out',async()=>{
  let active=0,max=0;
  const results=await mapBounded([0,1,2,3,4,5],2,async i=>{
    active++;max=Math.max(max,active);
    await new Promise(resolve=>setImmediate(resolve));
    active--;
    return i*i;
  });
  assert.equal(max,2);
  assert.deepEqual(results,[0,1,4,9,16,25]);
});

test('time-window and group readers use bounded independent lanes',()=>{
  const culture=readFileSync(new URL('../app/loc/culture-query.js',import.meta.url),'utf8');
  const galaxy=readFileSync(new URL('../app/loc/galaxy-query.js',import.meta.url),'utf8');
  assert.match(culture,/mapBounded\(windows,2,/);
  assert.match(culture,/mapBounded\(managedScopes,2,/);
  assert.match(culture,/mapBounded\(scopes,2,/);
  assert.match(galaxy,/mapBounded\(Array\.isArray\(scopes\)\?scopes:\[\],2,/);
});


test('shared public read budget cannot exceed 10 concurrent slots',async()=>{
  const {createPublicReadBudget}=await import('../app/loc/providers/kysely-read-budget.mjs');
  let active=0,maximum=0;
  const budget=createPublicReadBudget(500);
  const items=await Promise.all(Array.from({length:40},(_,i)=>budget(async()=>{
    active++;maximum=Math.max(maximum,active);
    await new Promise(resolve=>setImmediate(resolve));
    active--;return i;
  })));
  assert.equal(maximum,10);
  assert.equal(items.length,40);
});

