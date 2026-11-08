import {readFileSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {isTextSearchQuery,createSearchQos} from '../app/loc/providers/search-qos.mjs';

test('only Galaxy.content text predicates trigger QoS',()=>{
  const base={kind:'query',operation:'select',table:'lo3rwang_galaxy'};
  assert.equal(isTextSearchQuery({...base,or:['content.ilike."%混沌%"']}),true);
  assert.equal(isTextSearchQuery({...base,filters:[{column:'content',operator:'ilike',value:'%a%'}]}),true);
  assert.equal(isTextSearchQuery({...base,filters:[{column:'uid',operator:'eq',value:'Ab12Cd34'}]}),false);
  assert.equal(isTextSearchQuery({...base,filters:[{column:'date',operator:'gte',value:'2026-01-01'}]}),false);
  assert.equal(isTextSearchQuery({...base,filters:[{column:'place_id',operator:'eq',value:'a'}]}),false);
  assert.equal(isTextSearchQuery({...base,operation:'update',or:['content.ilike."%混沌%"']}),false);
  assert.equal(isTextSearchQuery({kind:'query',operation:'select',table:'lrunes_anchor',
    or:['description.ilike."%詞%"']}),false);
  assert.equal(isTextSearchQuery({kind:'analytics',operation:'select',table:'lo3rwang_galaxy'}),false);
});
test('rapid searches are denied, repeated abuse is blacklisted temporarily',()=>{
  let now=100000;
  const check=createSearchQos({now:()=>now,max:3,minIntervalMs:3000,blockMs:120000});
  assert.equal(check('client').allowed,true);
  now+=500;
  const fast=check('client');
  assert.equal(fast.allowed,false);
  assert.equal(fast.retryAfterMs,2500);
  now+=500;
  assert.equal(check('client').allowed,false);
  now+=500;
  const block=check('client');
  assert.equal(block.blocked,true);
  assert.equal(block.retryAfterMs,120000);
  now+=1000;
  assert.equal(check('client').blocked,true);
  now+=121000;
  assert.equal(check('client').allowed,true);
});
test('cross-Scope Galaxy search requests have no artificial SQL spacing',()=>{
  let now=100000;
  const check=createSearchQos({now:()=>now});
  for(let i=0;i<4;i++)assert.equal(check('reader').allowed,true);
  now+=3000;
  assert.equal(check('reader').allowed,true);
});
test('Search QoS errors never trigger backup reads or mark primary unavailable',()=>{
  const source=readFileSync(new URL('../app/loc/db-query.mjs',import.meta.url),'utf8');
  assert.ok(source.includes("code==='SEARCH_RATE_LIMIT'||code==='SEARCH_TIMEOUT'"));
  assert.ok(source.includes('markPrimaryReadFailed(table,error)'));
  assert.ok(source.includes("!['SEARCH_RATE_LIMIT','SEARCH_TIMEOUT'].includes"));
});
test('different clients are independent; expired windows clear',()=>{
  let now=100000;
  const check=createSearchQos({now:()=>now,max:2,minIntervalMs:1000,windowMs:3000,blockMs:10000});
  assert.equal(check('a').allowed,true);
  assert.equal(check('b').allowed,true);
  now+=3200;
  assert.equal(check('a').allowed,true);
});
