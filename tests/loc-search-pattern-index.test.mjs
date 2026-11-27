import test from 'node:test';
import assert from 'node:assert/strict';
import {applyFeaturedSearchResults,searchPatternSuggestions}
  from '../app/loc/search/search-pattern-index.mjs';

test('Pattern autocomplete normalizes text, ranks prefix matches, deduplicates and limits results',()=>{
  const suggestions=searchPatternSuggestions([{title:'混合'},{title:'混'},{title:'混色'},{title:'混  合'}],'混',2);
  assert.equal(suggestions.length,2);assert.equal(suggestions[0],'混');
  assert.ok(suggestions.includes('混合'));
  assert.deepEqual(searchPatternSuggestions([{title:'混合'}],'  ',36),[]);
});
test('Pattern.description UID injects its same-Scope page and prioritizes it',()=>{
  const ordinary={key:'culture:ordinary',scopeId:'culture',resourceType:'galaxy',resourceId:'OTHER001'};
  const rows=applyFeaturedSearchResults([ordinary],[{scopeId:'culture',title:'春日',featuredUid:'PAGE0001'}],
    [{scope_id:'culture',uid:'PAGE0001',title:'春日特輯',site:'vocus',list:true,search:true,extract:true}],
    '春日回顧',(row,source,scopeId)=>({key:scopeId+':'+row.uid,scopeId,resourceType:'galaxy',resourceId:row.uid,title:row.title,source}));
  assert.equal(rows[0].resourceId,'PAGE0001');assert.equal(rows[0].featured,true);
  assert.equal(rows[0].featuredPatternTitle,'春日');assert.equal(rows[1],ordinary);
});
test('an existing article is marked without duplication',()=>{
  const existing={key:'culture:PAGE0001',scopeId:'culture',resourceType:'galaxy',resourceId:'PAGE0001'};
  const rows=applyFeaturedSearchResults([existing],[{scopeId:'culture',title:'春日',featuredUid:'PAGE0001'}],
    [{scope_id:'culture',uid:'PAGE0001'}],'春日',()=>{throw Error('should not convert a duplicate');});
  assert.equal(rows.length,1);assert.equal(rows[0].featured,true);
});
test('invalid UIDs and cross-Scope articles are not pinned',()=>{
  const rows=applyFeaturedSearchResults([],[
    {scopeId:'culture',title:'春日',featuredUid:'not-a-uid'},
    {scopeId:'culture',title:'春節',featuredUid:'PAGE0002'}
  ],[{scope_id:'statics',uid:'PAGE0002'}],'春日 OR 春節',()=>{throw Error('cross-Scope target should not be used');});
  assert.deepEqual(rows,[]);
});
test('excluded Search terms do not trigger a featured page',()=>{
  const rows=applyFeaturedSearchResults([],[{scopeId:'culture',title:'春日',featuredUid:'PAGE0001'}],
    [{scope_id:'culture',uid:'PAGE0001'}],'!春日',()=>{throw Error('excluded term should not pin a page');});
  assert.deepEqual(rows,[]);
});
