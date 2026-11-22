import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {publishedSourceTaxonomy} from '../app/modular/published-source-taxonomy.js';
import {ITEM_LANE_OPTIONS,validateItemLane}
  from '../app/loc/statistics/item-confluence-model.mjs';

const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('multimedia platforms belong to the one LOC-wide source taxonomy',()=>{
  const taxonomy=publishedSourceTaxonomy();
  const from=(taxonomy.categories||[]).filter(row=>row.root==='media'&&row.type==='from');
  const labels=from.map(row=>row.display_name);
  assert.ok(labels.includes('Suno'));
  assert.ok(labels.includes('Spotify'));
  assert.ok(labels.includes('Youtube'));
  assert.ok(!labels.includes('Facebook'));
  // Media classification is stored as source metadata, not media item counts.
  assert.ok(from.every(row=>typeof row.category_code==='string'));
});

test('item confluence sources are only Galaxy.site selectors',()=>{
  assert.ok(ITEM_LANE_OPTIONS.every(item=>item.value.startsWith('galaxy:')));
  const scopes=[{id:'lo3rwang'}];
  assert.equal(validateItemLane({scopeId:'lo3rwang',source:'galaxy:all'},scopes).valid,true);
  assert.equal(validateItemLane({scopeId:'lo3rwang',source:'media:all'},scopes).valid,false);
  assert.equal(validateItemLane({scopeId:'lo3rwang',source:'media:exact',exact:'suno'},scopes).valid,false);
});

test('statistics and Culture never open a parallel MediaAnchor counting lane',()=>{
  const stat=source('app/modular/features/Statistics.jsx');
  const culture=source('app/modular/features/Culture.jsx');
  const sql=source('app/loc/providers/kysely-analytics.mjs');
  const client=source('app/loc/statistics/item-confluence-query.js');
  const server=source('app/loc/server/public-named-transactions.mjs');
  assert.doesNotMatch(stat,/value="media"|rankingType==='media'/);
  assert.doesNotMatch(culture,/CultureMediaRiver|value='media'/);
  assert.doesNotMatch(sql,/mediaTypeGroups|options\\.media===true/);
  assert.doesNotMatch(client,/p_options:\\{media/);
  assert.doesNotMatch(server,/mediaTypeGroups/);
  assert.match(sql,/scope\\+'_galaxy'/);
});
