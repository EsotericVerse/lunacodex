import {readFileSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {isTextSearchQuery,createSearchQos} from '../app/loc/providers/search-qos.mjs';

test('only explicit Galaxy.content text predicates trigger Search QoS',()=>{
  const base={kind:'query',operation:'select',table:'lo3rwang_galaxy'};
  assert.equal(isTextSearchQuery({...base,or:['content.ilike."%混沌%"']}),true);
  assert.equal(isTextSearchQuery({...base,filters:[{column:'content',op:'ilike',value:'%a%'}]}),true);
  assert.equal(isTextSearchQuery({...base,orFilters:[{
    type:'or',items:[{type:'predicate',column:'uid',operator:'eq',value:'abc'},
      {type:'predicate',column:'content',operator:'contains',value:'月'}]
  }]}),true,'parsed Kysely grouped text predicates are recognized');
  assert.equal(isTextSearchQuery({...base,filters:[{column:'uid',op:'eq',value:'Ab12Cd34'}]}),false);
  assert.equal(isTextSearchQuery({...base,filters:[{column:'date',op:'gte',value:'2026-01-01'}]}),false);
  assert.equal(isTextSearchQuery({...base,filters:[{column:'place_id',op:'eq',value:'a'}]}),false);
  assert.equal(isTextSearchQuery({...base,operation:'update',or:['content.ilike."%混沌%"']}),false);
  assert.equal(isTextSearchQuery({kind:'query',operation:'select',table:'lrunes_anchor',
    or:['description.ilike."%詞%"']}),false);
  assert.equal(isTextSearchQuery({kind:'analytics',operation:'select',table:'lo3rwang_galaxy'}),false);
});

test('existing search request budget stays 24 per minute, without SQL spacing',()=>{
  let now=100000;
  const check=createSearchQos({now:()=>now});
  for(let i=0;i<24;i++)assert.equal(check('reader').allowed,true);
  const exceeded=check('reader');
  assert.equal(exceeded.allowed,false);
  assert.equal(exceeded.blocked,false);
  assert.equal(exceeded.retryAfterMs,60000);
  assert.equal(check('another-reader').allowed,true);
  now+=60001;
  assert.equal(check('reader').allowed,true);
});

test('native optimized Karaul Poisson blocks a sustained spike, then expires',()=>{
  let now=100000;
  const check=createSearchQos({now:()=>now});
  for(let i=0;i<40;i++)check('burst');
  now+=5000;
  const denied=check('burst');
  assert.equal(denied.allowed,false);
  assert.equal(denied.blocked,true);
  assert.equal(denied.retryAfterMs,120000);
  assert.equal(check('reader').allowed,true);
  now+=120001;
  assert.equal(check('burst').allowed,true);
});

test('Karaul errors remain advisory, native request budget still applies',()=>{
  let now=100000;
  const check=createSearchQos({now:()=>now,detect:()=>{throw Error('missing');}});
  for(let i=0;i<40;i++)check('burst');
  now+=5000;
  assert.equal(check('burst').allowed,false);
  assert.equal(check('burst').blocked,false);
});

test('Search QoS 429 is issued before SQL, not converted into backup reads',()=>{
  const entry=readFileSync(new URL('../app/loc/server/native-public-query.mjs',import.meta.url),'utf8');
  const reader=readFileSync(new URL('../app/loc/db-query.mjs',import.meta.url),'utf8');
  assert.ok(entry.includes("code:'SEARCH_RATE_LIMIT'"));
  assert.ok(entry.indexOf('checkSearchQos(source)')<entry.indexOf('const selected=await database('));
  assert.ok(entry.includes("'retry-after'"));
  assert.ok(reader.includes("code==='SEARCH_RATE_LIMIT'||code==='SEARCH_TIMEOUT'"));
  assert.ok(reader.includes("!['SEARCH_RATE_LIMIT','SEARCH_TIMEOUT'].includes"));
});
