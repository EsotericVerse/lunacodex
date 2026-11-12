import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parse as parseJsx} from '@babel/parser';
import {territoryYearWindow,territoryRegions,territoryPointGroups,territoryWithAnchors}
  from '../app/modular/features/trace/trace-territory.mjs';
import {traceArticleIdFilters} from '../app/modular/features/trace/trace-panel-filters.mjs';

const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const sample=[
  {source_scope:'lo3rwang',place_id:'AbCd1234',day:'2026-01-02',site:'Facebook',item_count:10},
  {source_scope:'lo3rwang',place_id:'AbCd1234',day:'2026-04-12',site:'Threads',item_count:2},
  {source_scope:'lo3rwang',place_id:'DdEe5678',day:'2026-04-12',site:'Facebook',item_count:1},
  {source_scope:'lrunes',place_id:'AbCd1234',day:'2026-10-12',site:'Vocus',item_count:3},
  {source_scope:'lo3rwang',place_id:'Zzzz9999',day:'2025-12-31',site:'Facebook',item_count:100},
];
test('one whole year is used, never an unbounded history',()=>{
  assert.deepEqual(territoryYearWindow(2026),{startDate:'2026-01-01',endDate:'2026-12-31'});
  assert.throws(()=>territoryYearWindow('all'));
  const regions=territoryRegions(sample,2026);
  assert.equal(regions.length,3);
  assert.equal(regions.reduce((sum,row)=>sum+row.total,0),16);
  assert.equal(regions.some(row=>row.uid==='Zzzz9999'),false);
});
test('place source shares and article dates remain exact',()=>{
  const region=territoryRegions(sample,2026).find(row=>
    row.uid==='AbCd1234'&&row.source_scope==='lo3rwang');
  assert.equal(region.total,12);
  assert.deepEqual(region.sources.map(row=>[row.name,row.count]),[
    ['Facebook',10],['Threads',2]
  ]);
  assert.ok(Math.abs(region.sources[0].percent-83.33333333333333)<1e-8);
  assert.deepEqual(region.timeline,[{day:'2026-01-02',count:10},{day:'2026-04-12',count:2}]);
});
test('matching IDs from different Scopes never merge',()=>{
  const rows=territoryRegions(sample,2026).filter(row=>row.uid==='AbCd1234');
  assert.equal(rows.length,2);
  assert.notEqual(rows[0].source_scope,rows[1].source_scope);
});
test('every place appears in the register even without geographic coordinates',()=>{
  const regions=territoryRegions(sample,2026);
  const result=territoryWithAnchors(regions,[{
    uid:'AbCd1234',source_scope:'lo3rwang',title:'板橋車站',longitude:121.5,latitude:25.02
  }]);
  assert.equal(result.length,3);
  assert.equal(result.find(row=>row.uid==='DdEe5678').point,null);
  assert.equal(result.find(row=>row.source_scope==='lo3rwang'&&row.uid==='AbCd1234').title,'板橋車站');
  assert.deepEqual(territoryPointGroups(regions,1).map(row=>row.ids.length),[1,1,1]);
});
test('the strategy interior reuses the existing article list with the correct scope',()=>{
  const classic=traceArticleIdFilters(['AbCd1234'],{startDate:'2026-01-01',endDate:'2026-12-31'});
  const territory=traceArticleIdFilters(['AbCd1234'],{
    startDate:'2026-01-01',endDate:'2026-12-31',allPlacedArticles:true
  });
  assert.equal(classic.some(row=>row.column==='trace'),true);
  assert.equal(territory.some(row=>row.column==='trace'),false);
  assert.deepEqual(territory.find(row=>row.column==='place_id').value,'AbCd1234');
  assert.equal(territory.find(row=>row.column==='date'&&row.operator==='lte').value,'2026-12-31');
});
test('source names are case-insensitive without losing their visible name',()=>{
  const rows=territoryRegions([
    {source_scope:'lo3rwang',place_id:'AbCd1234',day:'2026-01-03',site:'Facebook',item_count:3},
    {source_scope:'lo3rwang',place_id:'AbCd1234',day:'2026-01-04',site:'facebook',item_count:2},
    {source_scope:'lo3rwang',place_id:'AbCd1234',day:'2026-01-05',site:'Threads',item_count:5}
  ],2026);
  assert.equal(rows.length,1);
  assert.deepEqual(rows[0].sources.map(row=>[row.name,row.count,row.percent]),
    [['Facebook',5,50],['Threads',5,50]]);
});
test('the annual source summary is exposed on existing SQL ports, with no Schema changes',()=>{
  for(const path of ['app/loc/providers/kysely-analytics.mjs',
    'app/loc/providers/kysely-browser.mjs','app/loc/server/native-public-query.mjs']){
    assert.match(source(path),/trace_territory/,path);
  }
  const backend=source('app/loc/providers/kysely-analytics.mjs');
  assert.match(backend,/groupBy\(\['place_id','site','date'\]\)/);
  assert.match(backend,/g\.place_id is not null/);
  const client=source('app/modular/features/trace/TraceTerritoryPanel.jsx');
  assert.match(client,/p_view:'trace_territory'/);
  assert.match(client,/queryKey:\['trace-territory-v1',year/);
  assert.match(client,/onChange=\{event=>\{setStep\(Number\(event\.target\.value\)\)/);
  assert.match(client,/allPlacedArticles/);
  assert.match(client,/Number\.isFinite\(Number\(point\.longitude\)\)/);
  assert.match(client,/point\.longitude!=null&&point\.latitude!=null/);
  assert.match(source('app/modular/features/Trace.jsx'),/路徑痕跡圖/);
  assert.match(source('app/modular/features/Trace.jsx'),/年度文章地點圖/);
});

test('the single Trace viewport defaults to full-year territories and defers route loads',()=>{
  const sourceCode=source('app/modular/features/Trace.jsx');
  assert.match(sourceCode,/useState\('territory'\)/);
  assert.match(sourceCode,/enabled:supported&&routeListOpen&&mapMode==='routes'/);
  assert.match(sourceCode,/enabled:isLoc&&supported&&mapMode==='routes'/);
  assert.match(sourceCode,/enabled:!isLoc&&supported&&mapMode==='routes'/);
  assert.match(sourceCode,/enabled:mapMode==='routes'&&annualGaugeOn/);
  assert.match(sourceCode,/mapMode==='territory'\?<TraceTerritoryPanel/);
  const first=sourceCode.indexOf('年度文章地點圖');
  const second=sourceCode.indexOf('路徑痕跡圖');
  assert.ok(first>=0&&second>first);
  const territory=source('app/modular/features/trace/TraceTerritoryPanel.jsx');
  assert.match(territory,/useState\(2026\)/);
  assert.match(territory,/p_start:period.startDate,p_end:period.endDate/);
  assert.doesNotMatch(territory,/setInterval\(/);
  const query=source('zenstack/client-queries.js');
  assert.match(query,/no TanStack, no SWR, no browser cache, no polling/);
});

test('Motion changes map modes without mounting two MapLibre canvases together',()=>{
  const trace=source('app/modular/features/Trace.jsx');
  assert.ok(parseJsx(trace,{sourceType:'module',plugins:['jsx']}).program.body.length>0);
  assert.match(trace,/import \{motion,useReducedMotion\} from 'motion\/react'/);
  assert.match(trace,/<motion\.div key=\{mapMode\} className="loc-trace-map-transition"/);
  assert.match(trace,/mapMode==='territory'\?<TraceTerritoryPanel scopeId=\{scopeId\}\/\>:/);
  assert.match(trace,/<\/TraceMap>\}\s*<\/motion\.div>/);
  assert.match(trace,/layoutId=\{'trace-mode-'\+scopeId\}/);
  assert.match(trace,/initial=\{reduceMotion\?false:/);
  assert.doesNotMatch(trace,/<AnimatePresence/);
});
