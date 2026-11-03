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
test('legacy single-Class metadata accepted only for its original Class',()=>{
 const config={keyword_meta:{class_uid:'ClA1',matchedDocuments:3},
  staticstime:'2026-10-30T00:00:00Z'};
 assert.equal(keywordClassState(config,'ClA1').matchedDocuments,3);
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

test('native eight-character Anchor Class UID supports reanalysis and preserves other results',()=>{
 const first=completeKeywordClass({},'ZCBXGIGR',{matchedDocuments:67},'2026-11-03T00:00:00Z');
 const both=completeKeywordClass(first,'ETKCQBAQ',{matchedDocuments:66},'2026-11-03T00:01:00Z');
 assert.equal(keywordClassState({keyword_meta:both},'ZCBXGIGR').matchedDocuments,67);
 assert.equal(keywordClassState({keyword_meta:both},'ETKCQBAQ').matchedDocuments,66);
 const stale=invalidateKeywordClass(both,'ZCBXGIGR');
 assert.equal(keywordClassState({keyword_meta:stale},'ZCBXGIGR'),null);
 assert.equal(keywordClassState({keyword_meta:stale},'ETKCQBAQ').matchedDocuments,66);
 assert.equal(activeKeywordMeta({keyword_meta:both},'ZCBXGIGR').matchedDocuments,67);
});
test('Class state rejects malformed UID without losing mixed-case Base62 IDs',()=>{
 const meta=completeKeywordClass({},'aB12cD34',{matchedDocuments:1},'2026-11-03T00:00:00Z');
 assert.equal(keywordClassState({keyword_meta:meta},'aB12cD34').matchedDocuments,1);
 assert.equal(keywordClassState({keyword_meta:meta},'AB12CD34'),null);
 for(const uid of ['','ABCDE','ABCDEFG','ABCDEFGHI','AB_CDE12']){
   assert.equal(keywordClassState({keyword_meta:meta},uid),null);
   assert.throws(()=>invalidateKeywordClass(meta,uid),/Invalid Keywords Class UID/);
 }
});
