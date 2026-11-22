import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {GALAXY_READ_MODEL_FIELDS} from '../packages/zenstack/galaxy-read-models.mjs';
import {galaxyInterNetEdges} from '../packages/zenstack/galaxy-inter-net.mjs';

const source=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');

test('Media URL links never become typed Anchor UID ZModel relationships',()=>{
  assert.equal(Object.hasOwn(GALAXY_READ_MODEL_FIELDS.GalaxyUidAnchor,'media_link'),false);
  assert.equal(Object.hasOwn(GALAXY_READ_MODEL_FIELDS.GalaxyUidRead,'media_link'),false);
  const zmodel=source('packages/zenstack/schema.zmodel');
  const begin=zmodel.indexOf('type GalaxyUidAnchor {');
  const end=zmodel.indexOf('type GalaxyList {',begin);
  assert.ok(begin>=0&&end>begin);
  assert.doesNotMatch(zmodel.slice(begin,end),/media_link/);
});

test('Galaxy media link URLs are directly exposed as URLs',()=>{
  const link='https://suno.com/song/12345678';
  const row={uid:'ABCD1234',title:'Article',media_link:[link,'ABCDEFGH']};
  const graph=galaxyInterNetEdges(row);
  assert.equal(graph.branches.media.length,1);
  assert.deepEqual(graph.branches.media.map(edge=>({value:edge.value,kind:edge.kind})),
    [{value:link,kind:'url'}]);
});

test('Article detail explicitly selects the plain physical URL array',()=>{
  const gallery=source('app/loc/galaxy/galaxy-query.js');
  assert.match(gallery,/galaxyUidReadWithPolicyColumns=\(\)=>unique\(\[/);
  assert.match(gallery,/media_link'\s*\]\)/);
  const trace=source('app/modular/features/trace/TracePlaceResults.jsx');
  assert.match(trace,/row\.attr\?\.url/);
  assert.match(trace,/operator:'overlaps',value:mediaUrls/);
  assert.doesNotMatch(trace,/operator:'overlaps',value:mediaIds/);
});
