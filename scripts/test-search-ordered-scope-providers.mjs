import test from 'node:test';
import assert from 'node:assert/strict';
import {searchOrderedScopeProviders} from '../app/loc/search-ordered-scope-providers.mjs';

function provider(id,fn){return {id,search:fn};}
function deferred(){
  let resolve,reject;
  const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}
const empty=()=>({rows:[],hasMore:false,nextCursor:null});

test('first Scope hit issues exactly one query and keeps stage cursor',async()=>{
  const seen=[];
  const providers=[
    provider('a',async(q,options)=>{seen.push(['a',q,options.cursor]);return {
      rows:[{uid:'A1234567'}],hasMore:false};}),
    provider('b',async()=>{seen.push('b');return empty();})
  ];
  const result=await searchOrderedScopeProviders(providers,'河',{limit:20});
  assert.deepEqual(seen,[['a','河',0]]);
  assert.equal(result.rows[0].uid,'A1234567');
  assert.deepEqual(result.nextCursor,{stage:2,offset:0,source:'auto'});
  assert.equal(result.hasMore,true);
});

test('a first Scope miss overlaps only two next Scopes, preserves earlier match',async()=>{
  const started=[];
  const slow=deferred(),fast=deferred();
  let lookaheadSignal;
  const providers=[
    provider('first',async()=>{started.push(1);return empty();}),
    provider('second',(_q,options)=>{started.push(2);return slow.promise;}),
    provider('third',(_q,options)=>{started.push(3);lookaheadSignal=options.signal;return fast.promise;}),
    provider('fourth',async()=>{started.push(4);return empty();})
  ];
  const request=searchOrderedScopeProviders(providers,'key',{limit:10});
  for(let i=0;i<8;i++)await Promise.resolve();
  assert.deepEqual(started,[1,2,3]);
  fast.resolve({rows:[{uid:'THIRD'}],hasMore:false});
  await Promise.resolve();
  slow.resolve({rows:[{uid:'SECOND'}],hasMore:true,nextCursor:12});
  const result=await request;
  assert.equal(result.rows[0].uid,'SECOND');
  assert.deepEqual(result.nextCursor,{stage:2,offset:12,source:'auto'});
  assert.deepEqual(started,[1,2,3]);
  assert.equal(lookaheadSignal.aborted,true);
});

test('stage/offset resume does not resend earlier Scopes or initiate lookahead',async()=>{
  const called=[];
  const providers=[
    provider('a',async()=>{called.push('a');return empty();}),
    provider('b',async(_q,opts)=>{
      called.push(['b',opts.cursor,opts.source]);
      return {rows:[{uid:'B'}],hasMore:true,nextCursor:33,dataSource:'configured'};
    }),
    provider('c',async()=>{called.push('c');return empty();})
  ];
  const result=await searchOrderedScopeProviders(providers,'ok',{
    cursor:{stage:2,offset:20,source:'configured'},limit:10
  });
  assert.deepEqual(called,[['b',20,'configured']]);
  assert.deepEqual(result.nextCursor,{stage:2,offset:33,source:'configured'});
});

test('all empty Scopes terminate automatically without additional Load More',async()=>{
  const seen=[];
  const providers=Array.from({length:6},(_,i)=>
    provider('p'+i,async()=>{seen.push(i);return empty();}));
  const result=await searchOrderedScopeProviders(providers,'absent',{limit:20});
  assert.equal(seen.length,6);
  assert.deepEqual(result,{rows:[],failures:[],hasMore:false,nextCursor:null});
});

test('a failing Scope does not hide a later matching Scope',async()=>{
  const result=await searchOrderedScopeProviders([
    provider('broken',async()=>{throw new Error('unavailable')}),
    provider('working',async()=>({rows:[{uid:'OK'}],hasMore:false}))
  ],'text',{limit:20});
  assert.equal(result.rows[0].uid,'OK');
  assert.equal(result.failures.length,1);
  assert.match(result.failures[0].message,/broken: unavailable/);
});

test('all errors still raise an AggregateError and include the last failure',async()=>{
  await assert.rejects(()=>searchOrderedScopeProviders([
    provider('one',async()=>{throw Error('first')}),
    provider('two',async()=>{throw Error('second')})
  ],'text',{limit:20}),error=>
    error instanceof AggregateError&&error.errors.length===2);
});

test('aborting while an early Scope waits halts later requests',async()=>{
  const controller=new AbortController(),pending=deferred();
  let calls=0;
  const request=searchOrderedScopeProviders([
    provider('a',()=>{calls++;return pending.promise}),
    provider('b',()=>{calls++;return empty()})
  ],'text',{limit:20,signal:controller.signal});
  for(let i=0;i<5;i++)await Promise.resolve();
  controller.abort();
  pending.resolve(empty());
  await assert.rejects(request,error=>error.name==='AbortError');
  assert.equal(calls,1);
});

test('empty query handling remains in the existing Search input boundary',async()=>{
  const result=await searchOrderedScopeProviders([],'',{limit:20});
  assert.equal(result.hasMore,false);
  assert.equal(result.nextCursor,null);
});
