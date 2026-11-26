import test from 'node:test';
import assert from 'node:assert/strict';
import {createDiscoveryKnownMatcher,createNewKeywordDiscovery} from '../app/loc/keywords/discovery.mjs';
import {createImportKeywordReview} from '../app/loc/import/keyword-review.mjs';

test('Item labels stay separate from their linked Pattern vocabulary',()=>{
  const rows=[{type:'item',name:'月光',lists:[]},
    {type:'item',name:'亮度',lists:['星火']},{type:'pattern',name:'火焰'}];
  assert.deepEqual(createDiscoveryKnownMatcher(rows)('月光火焰星火'),['火焰','星火'].sort((a,b)=>a.localeCompare(b)));
  const discovery=createNewKeywordDiscovery(rows);
  discovery.consume([{content:'月光 火焰'}]);
  const words=new Set(discovery.finish().candidates.map(x=>x.word));
  assert.ok(words.has('月光'));
  assert.ok(!words.has('火焰'));
});
test('Import review counts eligible confirmed documents, not rule expressions or HTML metadata',()=>{
  const review=createImportKeywordReview([{type:'item',title:'月光',patterns:[{title:'火焰'}]}]);
  review.consume([{title:'月光',content:'月光火焰'},{content:'火焰',keyword:false},
    {content:'<script>月光</script>其他'}]);
  assert.deepEqual(review.finish(),{scanned:2,matched:1,termCount:1,vocabulary:1,
    top:[['火焰',1]]});
});
