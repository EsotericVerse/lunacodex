import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createKeywordDocumentClassifier}
  from '../app/loc/model/keyword-engine.mjs';

test('keyword classifier is a shared module callable by server-side SQL analysis',async()=>{
  const source=await readFile(new URL('../app/loc/model/keyword-engine.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/^\s*['"]use client['"];?/);

  const classify=createKeywordDocumentClassifier([{
    item_no:1,item_name:'詞',class_group:'Class',order_no:1
  }]);
  const result=classify([{uid:'GALAXY01',title:'',scan_text:'這是一個詞。'}]);
  assert.equal(result.classifiedCount,1);
  assert.equal(result.classifications[0].top_rune,'詞');
});
