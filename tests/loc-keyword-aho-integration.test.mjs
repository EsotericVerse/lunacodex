import test from 'node:test';
import assert from 'node:assert/strict';
import {createDiscoveryKnownMatcher,createNewKeywordDiscovery} from '../app/loc/keywords/discovery.mjs';
import {createImportKeywordReview} from '../app/loc/import/keyword-review.mjs';

test('Discovery keeps a longer new phrase and excludes exact existing words',()=>{
  const rows=[{type:'item',name:'月光',lists:[]},{type:'pattern',name:'火焰'}];
  assert.deepEqual(createDiscoveryKnownMatcher(rows)('月光火焰'),['月光','火焰'].sort((a,b)=>a.localeCompare(b)));
  const discovery=createNewKeywordDiscovery(rows);
  discovery.consume([{content:'月光 火焰'}]);
  assert.ok(discovery.finish().candidates.every(x=>!['月光','火焰'].includes(x.word)));
});
test('Import review counts eligible confirmed documents, not rule expressions or HTML metadata',()=>{
  const review=createImportKeywordReview([{type:'item',title:'月光',attr:{keyword:['火焰']}}]);
  review.consume([{title:'月光',content:'月光火焰'},{content:'火焰',keyword:false},
    {content:'<script>月光</script>其他'}]);
  assert.deepEqual(review.finish(),{scanned:2,matched:1,termCount:2,vocabulary:2,
    top:[['月光',1],['火焰',1]].sort((a,b)=>a[0].localeCompare(b[0]))});
});
