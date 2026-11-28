import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LOC_LUCUS_ID,LOC_LUCUS_FACETS,LOC_LUCUS_RELATIONS,
  LOC_LUCUS_GRAPH,locLucusFacet,isLocLucusFacet
} from '../app/loc/lucus/loc-lucus.mjs';

test('LOCLucus has exactly the four fixed public facets',()=>{
  assert.equal(LOC_LUCUS_ID,'LOCLucus');
  assert.deepEqual(LOC_LUCUS_FACETS.map(facet=>facet.id),
    ['culture','trace','statics','search']);
  assert.deepEqual(LOC_LUCUS_RELATIONS.filter(edge=>edge.from===LOC_LUCUS_ID)
    .map(edge=>edge.to),['culture','trace','statics','search']);
});

test('LOCLucus facets point to their existing LOC relationship domains',()=>{
  assert.deepEqual(LOC_LUCUS_FACETS.map(({id,relation,hierarchy})=>({
    id,relation,hierarchy:[...hierarchy]
  })),[
    {id:'culture',relation:'time',hierarchy:['era','period','date']},
    {id:'trace',relation:'space',hierarchy:['trace','path','point']},
    {id:'statics',relation:'keyword',hierarchy:['category','class','group','item','pattern']},
    {id:'search',relation:'galaxy',hierarchy:['article','keyword']}
  ]);
  assert.equal(LOC_LUCUS_GRAPH.facets,LOC_LUCUS_FACETS);
  assert.equal(LOC_LUCUS_GRAPH.relations,LOC_LUCUS_RELATIONS);
});

test('LOCLucus facet lookup is stable and rejects unrelated feature names',()=>{
  assert.equal(locLucusFacet(' CULTURE '),LOC_LUCUS_FACETS[0]);
  assert.equal(isLocLucusFacet('search'),true);
  assert.equal(isLocLucusFacet('media'),false);
  assert.equal(locLucusFacet('unknown'),null);
});
