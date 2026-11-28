import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildTraceTerritoryRouteModel} from '../app/modular/features/trace/trace-territory-overlay.mjs';
import {LOC_MOTION} from '../app/modular/motion-tokens.mjs';

const root=new URL('../',import.meta.url);
const source=async path=>readFile(new URL(path,root),'utf8');
const key=(scope,uid)=>scope+':'+uid;

const trace={
  uid:'TRACE001',title:'北方痕跡',source_scope:'scope-a',trace_type:'trace',
  lucus_list:['POINT001'],route_list:{routes:['PATH0001']}
};
const pathRow={
  uid:'PATH0001',title:'第一路徑',source_scope:'scope-a',trace_type:'path',
  lucus_list:['POINT002'],route_list:{routes:[]}
};
const otherScopePath={
  uid:'PATH0002',title:'其他 Scope 路徑',source_scope:'scope-b',trace_type:'path',
  lucus_list:['POINT003'],route_list:{routes:[]}
};

test('LOC terrain defaults to a Trace parent and includes only its exact Path children',()=>{
  const model=buildTraceTerritoryRouteModel([trace,pathRow,otherScopePath]);
  assert.equal(model.selected.uid,trace.uid);
  assert.deepEqual(model.maps.map(row=>row.uid),[trace.uid,pathRow.uid]);
  assert.deepEqual(model.memberUids,['POINT001','POINT002']);
  assert.deepEqual(model.routeOptions.map(row=>row.uid),[pathRow.uid]);
});

test('selecting a Path narrows the terrain overlay without changing its Trace parent',()=>{
  const model=buildTraceTerritoryRouteModel(
    [trace,pathRow,otherScopePath],key('scope-a',trace.uid),key('scope-a',pathRow.uid)
  );
  assert.equal(model.activeTraceKey,key('scope-a',trace.uid));
  assert.equal(model.selected.uid,pathRow.uid);
  assert.deepEqual(model.maps.map(row=>row.uid),[pathRow.uid]);
  assert.deepEqual(model.memberUids,['POINT002']);
});

test('unassigned Paths remain selectable and never attach by geographic proximity',()=>{
  const model=buildTraceTerritoryRouteModel([otherScopePath]);
  assert.deepEqual(model.traceOptions,[{key:'__standalone__',label:'未歸屬路徑圖'}]);
  assert.equal(model.selected.uid,otherScopePath.uid);
  assert.deepEqual(model.maps.map(row=>row.uid),[otherScopePath.uid]);
  assert.deepEqual(model.memberUids,['POINT003']);
});

test('FeaturePage Motion targets the actual Hero copy rows and leaves page entrance to one boundary',async()=>{
  const ui=await source('app/modular/ui.jsx');
  assert.match(ui,/\.scope-feature-hero-copy > \.loc-eyebrow/);
  assert.match(ui,/\.scope-feature-hero-copy > \.home-title-row/);
  assert.match(ui,/\.scope-feature-hero-copy > \.scope-hero-description/);
  assert.doesNotMatch(ui,/contentPlayed|contentRef/);
  const boundary=await source('app/modular/PageResourceBoundary.jsx');
  assert.match(boundary,/releaseTransientPageResources/);
  assert.match(boundary,/useReducedMotion/);
  assert.match(boundary,/scope-page > \.scope-content/);
});

test('Search exposes cancellation and distinguishes cancelled from failed work',async()=>{
  const search=await source('app/modular/features/Search.jsx');
  assert.match(search,/function cancelSearch\(\)/);
  assert.match(search,/controller\.abort\(\)/);
  assert.match(search,/setStatus\('已取消搜尋。'\)/);
  assert.match(search,/signal:controller\.signal/);
  assert.match(search,/ActivityMotion state="cancelled"/);
});

test('public Search keeps its home/results stages and feature frames use theme tokens',async()=>{
  const search=await source('app/modular/features/Search.jsx');
  const css=await source('app/styles/public-features.css');
  assert.match(search,/data-search-stage=\{publicResultsMode\?'results':'home'\}/);
  assert.match(css,/\.scope-search-workspace\[data-search-stage="results"\]/);
  assert.match(css,/\.scope-search-workspace\[data-search-stage="results"\].*scope-search-suggestions/s);
  assert.match(css,/--loc-feature-emphasis:var\(--loc-accent\)/);
  for(const feature of ['culture','statics','search','trace'])
    assert.match(css,new RegExp('data-public-feature="' + feature + '"'));
});

test('LOC Trace combines annual terrain with the selected saved route in one map',async()=>{
  const preview=await source('app/modular/features/LocTracePreview.jsx');
  const panel=await source('app/modular/features/trace/TraceTerritoryPanel.jsx');
  const map=await source('app/modular/features/trace/TraceMap.jsx');
  assert.match(preview,/TraceTerritoryPanel scopeId="loc"/);
  assert.match(preview,/buildTraceTerritoryRouteModel/);
  assert.match(panel,/routeOverlay\?\.maps/);
  assert.match(panel,/selectedRouteUid=\{selectedRouteUid\}/);
  assert.match(map,/lineOnlySavedGraph/);
});

test('React Motion timing follows the published LOC timing scale',async()=>{
  assert.deepEqual(
    {fast:LOC_MOTION.fast,feedback:LOC_MOTION.feedback,standard:LOC_MOTION.standard,
      emphasis:LOC_MOTION.emphasis,arrival:LOC_MOTION.arrival},
    {fast:.16,feedback:.18,standard:.28,emphasis:.52,arrival:.9}
  );
  const css=await source('app/styles/loc-expressive-ui.css');
  assert.match(css,/--loc-motion-fast:160ms/);
  assert.match(css,/--loc-motion-standard:280ms/);
  assert.match(css,/--loc-motion-emphasis:520ms/);
});

test('Management graph uses vis-network and reads all colors from active theme tokens',async()=>{
  const graph=await source('app/modular/ManagementVisNetwork.jsx');
  assert.match(graph,/import\('vis-network\/esnext'\)/);
  assert.match(graph,/--loc-accent/);
  assert.doesNotMatch(graph,/#(?:[0-9a-f]{3,8})\b|rgba\(/i);
});
