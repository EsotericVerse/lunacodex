import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {summarizePlaceStatistics,placeRiverModel} from '../app/loc/place-statistics.mjs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('no articles and no spatial anchors are valid place model states',()=>{
  const summary=summarizePlaceStatistics({rows:[],anchors:[]});
  assert.deepEqual(summary,{places:[],total:0,anchorsCount:0,series:[],trend:[],distribution:[]});
  const river=placeRiverModel({rows:[],anchors:[]});
  assert.deepEqual(river,{items:[],groups:[],places:[],total:0,anchorsCount:0});
  assert.deepEqual(placeRiverModel(null).items,[]);
});

test('no saved trace anchor does not suppress a valid textual place',()=>{
  const data={rows:[
    {day:'2026-10-12',category:'板橋車站',item_count:2},
    {day:'2026-10-13',category:'板橋車站',item_count:1},
    {day:'2026-10-12',category:'',item_count:99},
    {day:null,category:'板橋車站',item_count:7}
  ],anchors:[]};
  const stat=summarizePlaceStatistics(data,{bucket:'month'});
  assert.equal(stat.places.length,1);
  assert.deepEqual(stat.places[0],{name:'板橋車站',count:3,anchored:false});
  assert.equal(stat.total,3);
  assert.equal(stat.trend[0].place_0,3);
  const river=placeRiverModel(data);
  assert.equal(river.items.length,2);
  assert.equal(river.groups.length,1);
  assert.equal(river.items[0].entry_type,'place_density');
});

test('saved spatial anchors annotate place identity without manufacturing visit dates',()=>{
  const stat=summarizePlaceStatistics({rows:[],anchors:[{title:'台南車站',uid:'12345678'}]});
  assert.equal(stat.anchorsCount,1);
  assert.equal(stat.total,0);
  assert.deepEqual(stat.trend,[]);
  assert.deepEqual(stat.places,[]);
});

test('Culture and Statistics use optional SQL place summaries without ISR or required keyword Class',()=>{
  const route=read('app/api/loc/scopes/[scopeId]/numeric/[kind]/route.js');
  const client=read('app/loc/numeric-isr-client.js');
  const culture=read('app/modular/features/Culture.jsx');
  const statistics=read('app/modular/features/Statistics.jsx');
  const cultPlace=read('app/modular/features/trace/CulturePlaceRiver.jsx');
  const statPlace=read('app/modular/features/trace/PlaceStatisticsPanel.jsx');
  assert.match(route,/status:410/);
  assert.match(read('app/loc/place-summary-client.js'),/p_view:'trace_places'/);
  assert.doesNotMatch(read('app/loc/place-summary-client.js'),/rpc\('read_scope_place_statistics'/);
  assert.match(read('supabase/migrations/20261103091000_scope_trace_places_analytics.sql'),/v_mode='trace_places'/);
  assert.match(client,/return false/);
  assert.match(culture,/<option value='trace'>痕跡（地點）<\/option>/);
  assert.match(culture,/<CulturePlaceRiver/);
  assert.match(statistics,/const STAT_TYPES=\['total','source','place'/);
  assert.match(statistics,/rankingType!=='place'&&Boolean\(targetScopes.length\)/);
  assert.match(statistics,/<PlaceStatisticsPanel scopeId=\{scopeId\} range=\{queryRange\}/);
  assert.match(cultPlace,/queryKey:\['loc-place-summary',scopeId,startDate,endDate\]/);
  assert.match(statPlace,/queryKey:\['loc-place-summary',scopeId,startDate,endDate\]/);
  assert.match(cultPlace,/!model.items.length/);
  assert.match(statPlace,/!model.places.length/);
});

test('Statistics displays per-Class precomputed results without Media facet queries',()=>{
  const stats=read('app/modular/features/Statistics.jsx');
  assert.ok(stats.includes("const STAT_TYPES=['total','source','place','keywords'];"));
  assert.ok(stats.includes("const sourceChart=['total','source'].includes(rankingType)"));
  assert.ok(stats.includes("const keywordDimension=rankingType==='keywords'"));
  assert.ok(stats.includes('classUid:resolvedKeywordClassUid'));
  assert.ok(stats.includes('key={resolvedKeywordClassUid}')||stats.includes("scopeId,resolvedKeywordClassUid,styleRange.startDate"));
  assert.doesNotMatch(stats,/selectMediaStatisticsFacetRows|MediaFacetStatistics|mediaDimension/);
  assert.ok(stats.includes('{keywordDimension?<>'));
  assert.ok(stats.includes('<Rune66Summary analysis={runeQuery.data}'));
  const culture=read('app/modular/features/Culture.jsx');
  assert.ok(culture.includes('setSelectedKeywordClassUid(event.target.value)'));
  assert.ok(culture.includes("['culture-style-filter','rune66',classificationScope,resolvedKeywordClassUid"));
});
