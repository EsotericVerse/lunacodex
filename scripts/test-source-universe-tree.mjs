import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SOURCE_KEYWORD_LEVELS,sourceTreeFromArrays,sourceTaxonomyFromArrays,
  sourceSiteKeyForLabel,sourceLabelMatchesSite
} from '../app/loc/source-classification.mjs';
import {publishedSourceTaxonomy,publishedSourceCategoryCatalog}
  from '../app/modular/published-source-taxonomy.js';

test('the four source types align exactly to the existing keyword levels',()=>{
  assert.deepEqual(SOURCE_KEYWORD_LEVELS,{
    universe:'category',galaxy:'class',domain:'group',from:'item'
  });
  const tree=sourceTreeFromArrays(['Facebook','Threads'],['方格子vocus','其他'],
    {universe:'loc',galaxy:'lo3rwang'});
  assert.equal(tree[0].type,'universe');
  assert.equal(tree[1].type,'galaxy');
  assert.equal(tree[1].parent,tree[0].key);
  assert.equal(tree.filter(row=>row.type==='domain').length,2);
  assert.equal(tree.filter(row=>row.type==='from').length,4);
  for(const node of tree.slice(2)){
    assert.equal(node.keyword_type,SOURCE_KEYWORD_LEVELS[node.type]);
    assert.ok(tree.some(parent=>parent.key===node.parent&&parent.children.includes(node.key)));
  }
  assert.equal(tree.find(row=>row.name==='Facebook').site,'Facebook');
});
test('site is never replaced with display label and aliases come from one rule',()=>{
  assert.equal(sourceSiteKeyForLabel('方格子vocus'),'vocus');
  assert.equal(sourceSiteKeyForLabel('無名wretch'),'wretch');
  assert.equal(sourceSiteKeyForLabel('其他'),'others');
  assert.equal(sourceSiteKeyForLabel('Facebook'),'facebook');
  assert.equal(sourceLabelMatchesSite('vocus','方格子vocus'),true);
  assert.equal(sourceLabelMatchesSite('others','其他'),true);
  assert.equal(sourceLabelMatchesSite('art','smart'),false);
  assert.equal(sourceLabelMatchesSite('facebook','Facebook'),true);
  const published=publishedSourceTaxonomy('lo3rwang');
  assert.ok(published.tree.find(row=>row.type==='universe'));
  assert.ok(published.tree.find(row=>row.type==='galaxy'&&row.name==='lo3rwang'));
  assert.ok(published.groupAliases.some(row=>row.source_key==='vocus'));
  assert.ok(published.groupAliases.some(row=>row.source_key==='wretch'));
  assert.ok(published.groupAliases.some(row=>row.source_key==='others'));
  assert.ok(publishedSourceCategoryCatalog('lo3rwang').aliases.some(row=>row.source_key==='vocus'));
});
test('legacy consumers get unchanged empty and flat taxonomy shapes',()=>{
  assert.deepEqual(sourceTaxonomyFromArrays([],[]),
    {categories:[],aliases:[],groups:[],groupAliases:[]});
  assert.deepEqual(sourceTaxonomyFromArrays(['Facebook'],['suno','FACEBOOK']).groups,
    [{group_code:'suno',display_name:'suno',enabled:true}]);
});
