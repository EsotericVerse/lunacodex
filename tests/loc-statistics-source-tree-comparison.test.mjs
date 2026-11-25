import test from 'node:test';
import assert from 'node:assert/strict';
import {publishedSourceTaxonomy}
  from '../app/modular/published-source-taxonomy.js';
import {sourceStatisticsTree,sourceTreeMetricId,SOURCE_UNCLASSIFIED_METRIC}
  from '../app/loc/statistics/source-tree-measures.mjs';

const taxonomy=publishedSourceTaxonomy();
const treeByTitle=new Map(taxonomy.tree.map(item=>[item.title,item]));
const stat=(name,result)=>result.totals.get(sourceTreeMetricId(treeByTitle.get(name).uid))||0;
const row=(site,count,extra={})=>({
  kind:'source',day:'2026-11-22',category:site,item_count:count,...extra
});

test('each native From rolls up exactly once along its saved Universe/Galaxy/Domain path',()=>{
  const model=sourceStatisticsTree([
    row('Facebook',2,{site_id:'1627699893985158:0'}),
    row('Threads',3,{site_id:'threads-native-22'}),
    row('vocus',7),
    row('ptt',3),
    row('unknown-platform',8)
  ],taxonomy);
  assert.equal(stat('Words',model),12);
  assert.equal(stat('CMS',model),5);
  assert.equal(stat('Meta',model),5);
  assert.equal(stat('Facebook',model),2);
  assert.equal(stat('Threads',model),3);
  assert.equal(stat('Article',model),7);
  assert.equal(stat('Post',model),7);
  assert.equal(stat('Vocus',model),7);
  assert.equal(stat('PastBy',model),3);
  assert.equal(stat('Closed',model),0);
  assert.equal(stat('NowON',model),3);
  assert.equal(model.totals.get(SOURCE_UNCLASSIFIED_METRIC),8);
  // A parent selected as its own comparison lane is a single rolled-up
  // metric, not a second pass that adds its already counted children again.
  const facebookId=sourceTreeMetricId(treeByTitle.get('Facebook').uid);
  const metaId=sourceTreeMetricId(treeByTitle.get('Meta').uid);
  assert.equal(model.metricIdsForSite('Facebook').filter(x=>x===metaId).length,1);
  assert.equal(model.metricIdsForSite('Facebook').filter(x=>x===facebookId).length,1);
});

