import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LUCUS_ARCHITECTURE_ID,LUCUS_FORMULA,LUCUS_MEANING,LUCUS_PLACEMENT,LUCUS_DESIGN_STATUS,
  LOC_LUCUS_ID,LOC_LUCUS_FACETS,LOC_LUCUS_RELATIONS,
  LOC_LUCUS_GRAPH,locLucusFacet,isLocLucusFacet
} from '../app/loc/lucus/loc-lucus.mjs';

test('Lucus has its fixed meaning and is distinct from its LOC projection',()=>{
  assert.equal(LUCUS_ARCHITECTURE_ID,'Lucus');
  assert.equal(LUCUS_FORMULA,'Lucas + Locus = Lucus');
  assert.equal(LUCUS_MEANING,'光之時空定錨點');
  assert.equal(LUCUS_PLACEMENT,'Universe Tree 上的神聖樹林');
  assert.equal(LUCUS_DESIGN_STATUS,'future');
  assert.equal(LOC_LUCUS_ID,'LOCLucus');
});

test('LOCLucus has exactly four fixed Lucus domains',()=>{
  assert.deepEqual(LOC_LUCUS_FACETS.map(({id,lucusId,domain,hierarchy})=>({
    id,lucusId,domain,hierarchy:[...hierarchy]
  })),[
    {id:'culture',lucusId:'TLucus',domain:'time',hierarchy:['era','period','date']},
    {id:'trace',lucusId:'LLucus',domain:'space',hierarchy:['trace','path','point']},
    {id:'statics',lucusId:'KLucus',domain:'keyword',hierarchy:['category','class','group','item','pattern']},
    {id:'search',lucusId:'SLucus',domain:'source',hierarchy:['universe','galaxy','domain','from']}
  ]);
  assert.deepEqual(LOC_LUCUS_RELATIONS.map(({from,to,facet,domain,kind})=>({
    from,to,facet,domain,kind
  })),[
    {from:'LOCLucus',to:'TLucus',facet:'culture',domain:'time',kind:'lucus-domain'},
    {from:'LOCLucus',to:'LLucus',facet:'trace',domain:'space',kind:'lucus-domain'},
    {from:'LOCLucus',to:'KLucus',facet:'statics',domain:'keyword',kind:'lucus-domain'},
    {from:'LOCLucus',to:'SLucus',facet:'search',domain:'source',kind:'lucus-domain'}
  ]);
  assert.equal(LOC_LUCUS_GRAPH.architecture,LUCUS_ARCHITECTURE_ID);
  assert.equal(LOC_LUCUS_GRAPH.facets,LOC_LUCUS_FACETS);
  assert.equal(LOC_LUCUS_GRAPH.relations,LOC_LUCUS_RELATIONS);
});

test('LOCLucus lookup resolves both public facet and typed Lucus identity',()=>{
  assert.equal(locLucusFacet(' CULTURE '),LOC_LUCUS_FACETS[0]);
  assert.equal(locLucusFacet('TLucus'),LOC_LUCUS_FACETS[0]);
  assert.equal(locLucusFacet('SLucus'),LOC_LUCUS_FACETS[3]);
  assert.equal(isLocLucusFacet('search'),true);
  assert.equal(isLocLucusFacet('media'),false);
  assert.equal(locLucusFacet('unknown'),null);
});
