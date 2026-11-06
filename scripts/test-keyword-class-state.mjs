import test from 'node:test';
import assert from 'node:assert/strict';
import {keywordClassState,completeKeywordClass,invalidateKeywordClass,activeKeywordMeta}
  from '../app/loc/keyword-class-state.mjs';
test('second Class reanalysis never deletes first Class metadata',()=>{
 const first=completeKeywordClass({},'ClA1',{matchedDocuments:5},'2026-10-30T00:00:00Z');
 const second=completeKeywordClass(first,'ClB1',{matchedDocuments:9},'2026-10-30T00:01:00Z');
 assert.equal(keywordClassState({keyword_meta:second},'ClA1').matchedDocuments,5);
 assert.equal(keywordClassState({keyword_meta:second},'ClB1').matchedDocuments,9);
 const stale=invalidateKeywordClass(second,'ClB1');
 assert.equal(keywordClassState({keyword_meta:stale},'ClB1'),null);
 assert.equal(keywordClassState({keyword_meta:stale},'ClA1').matchedDocuments,5);
});
test('scope-wide legacy completion date is never assigned to a Class',()=>{
 const config={keyword_meta:{class_uid:'ClA1',matchedDocuments:3},
  staticstime:'2026-10-30T00:00:00Z'};
 assert.equal(keywordClassState(config,'ClA1'),null);
 assert.equal(keywordClassState(config,'ClB1'),null);
});
test('Class selection is a view, not deletion of stored results',()=>{
 const meta=completeKeywordClass({},'ClA1',{classes:{Ga01:'靈魂'}},'2026-10-30T00:00:00Z');
 assert.deepEqual(activeKeywordMeta({keyword_meta:meta},'ClA1').classes,{Ga01:'靈魂'});
 assert.deepEqual(activeKeywordMeta({keyword_meta:meta},'ClB1').by_class,meta.by_class);
});

test('switching active Class never revives invalidated Class from global completion time',()=>{
 const first=completeKeywordClass({},'ClA1',{matchedDocuments:3},'2026-10-30T00:00:00Z');
 const second=completeKeywordClass(first,'ClB1',{matchedDocuments:5},'2026-10-30T00:02:00Z');
 const stale=invalidateKeywordClass(second,'ClA1');
 const config={keyword_meta:{...stale,class_uid:'ClA1'},staticstime:'2026-10-30T00:02:00Z'};
 assert.equal(keywordClassState(config,'ClA1'),null);
 assert.equal(keywordClassState(config,'ClB1').matchedDocuments,5);
});

test('native eight-character Anchor Class keeps state, invalidation and completion',()=>{
 const uid='ZCBXGIGR',date='2026-11-03T00:00:00Z';
 const meta=completeKeywordClass({},uid,{matchedDocuments:67},date);
 assert.equal(keywordClassState({keyword_meta:meta},uid).matchedDocuments,67);
 assert.equal(activeKeywordMeta({keyword_meta:meta},uid).matchedDocuments,67);
 const stale=invalidateKeywordClass(meta,uid);
 assert.equal(keywordClassState({keyword_meta:stale},uid),null);
 const restored=completeKeywordClass(stale,uid,{matchedDocuments:5},date);
 assert.equal(keywordClassState({keyword_meta:restored},uid).matchedDocuments,5);
});
test('Class UIDs remain case-sensitive and only four or eight Base62 characters',()=>{
 const uid='ZCBXGIGR',date='2026-11-03T00:00:00Z';
 const meta=completeKeywordClass({},uid,{},date);
 assert.equal(keywordClassState({keyword_meta:meta},'zCBXGIGR'),null);
 for(const invalid of ['ABC','ABCDE','ABCDEFG','ABCDEFGHI','abcd123!']){
   assert.throws(()=>invalidateKeywordClass({},invalid),/Invalid Keywords Class UID/);
   assert.throws(()=>completeKeywordClass({},invalid,{},date),/Invalid analysis completion/);
 }
});

test('switching Classes shows their own last parsed date, never the shared date',()=>{
 const first='2026-11-01T11:00:00Z',second='2026-11-06T17:00:00Z';
 let meta=completeKeywordClass({},'ClassA01',{matchedDocuments:12},first);
 meta=completeKeywordClass(meta,'ClassB02',{matchedDocuments:48},second);
 const config={keyword_meta:meta,staticstime:'2099-01-01T00:00:00Z'};
 assert.equal(keywordClassState(config,'ClassA01')?.completedAt,first);
 assert.equal(keywordClassState(config,'ClassB02')?.completedAt,second);
 const reset=invalidateKeywordClass(meta,'ClassB02');
 assert.equal(keywordClassState({keyword_meta:reset,staticstime:second},'ClassB02'),null);
 assert.equal(keywordClassState({keyword_meta:reset},'ClassA01')?.completedAt,first);
});
