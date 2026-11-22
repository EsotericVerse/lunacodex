import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {publishedSourceTaxonomy} from '../app/modular/published-source-taxonomy.js';
import {buildCultureRiverRootPayload,buildCultureRiverRootTotals,selectCultureRiverChildren}
  from '../app/loc/culture/river-roots.mjs';
import {availableMemberMeasures}
  from '../app/loc/statistics/member-intersection-model.mjs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const fixture={
  text:[
    {day:'2026-11-20',category:'Suno',item_count:3},
    {day:'2026-11-20',category:'Facebook',item_count:5}
  ],
  // Retired MediaAnchor statistics must never create another root or count.
  media:[{day:'2026-11-20',category:'video',item_count:999}]
};

test('Culture multimedia sources are in loc_anchor taxonomy, not a parallel count',()=>{
  const taxonomy=publishedSourceTaxonomy();
  const {rootBuckets,groups,numericRows}=buildCultureRiverRootPayload(fixture,taxonomy);
  assert.deepEqual(rootBuckets.map(row=>[row.category,row.item_count]).sort(),
    [['media',3],['system',5]]);
  assert.equal(numericRows.length,2);
  assert.equal(groups.reduce((sum,row)=>sum+row.item_count,0),8);
  assert.ok(groups.every(row=>row.category_type==='source'));
  const mediaNodes=selectCultureRiverChildren(numericRows,taxonomy,['media']);
  assert.deepEqual(mediaNodes.map(row=>row.category),['Suno']);
  const totals=buildCultureRiverRootTotals(fixture,taxonomy);
  assert.equal(totals.groups.reduce((sum,row)=>sum+row.item_count,0),8);
});

test('cross-member statistics no longer offer independent media metrics',()=>{
  const metrics=availableMemberMeasures([[
    {kind:'media',category:'video',item_count:999},
    {kind:'source',category:'Suno',item_count:3}
  ]]);
  assert.equal(metrics.some(metric=>metric.id==='multimedia'||metric.id.startsWith('media:')),false);
});

test('deprecated media statistics modules are absent',()=>{
  for(const path of [
    'app/modular/features/media/CultureMediaRiver.jsx',
    'app/loc/statistics/facets.js',
    'app/loc/statistics/media-site-statistics.mjs'
  ])assert.equal(existsSync(new URL('../'+path,import.meta.url)),false,path);
  const reader=read('app/loc/galaxy/galaxy-query.js');
  assert.doesNotMatch(reader,/selectMediaCrossPairWorks|selectMediaCrossTagRows|StatisticsFacets/);
  const site=read('app/loc/culture/river-roots.mjs');
  assert.doesNotMatch(site,/row\\?\\.kind==='media'|category_type:'media'/);
});
