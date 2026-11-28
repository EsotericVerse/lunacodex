import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {traceRouteHierarchy} from '../app/modular/features/trace/trace-route-hierarchy.mjs';
import {LOC_MOTION} from '../app/modular/motion-tokens.mjs';

const root=new URL('../',import.meta.url);
const source=async path=>readFile(new URL(path,root),'utf8');
const trace={
  uid:'TRACE001',title:'北方痕跡',source_scope:'scope-a',trace_type:'trace',
  route_list:{routes:['PATH0001']}
};
const pathRow={
  uid:'PATH0001',title:'第一路徑',source_scope:'scope-a',trace_type:'path',
  route_list:{routes:[]}
};
const otherScopePath={
  uid:'PATH0002',title:'其他 Scope 路徑',source_scope:'scope-b',trace_type:'path',
  route_list:{routes:[]}
};

test('Trace hierarchy follows persisted Path UIDs and keeps Scope ownership exact',()=>{
  const hierarchy=traceRouteHierarchy([trace,pathRow,otherScopePath]);
  assert.equal(hierarchy.groups.length,1);
  assert.equal(hierarchy.groups[0].trace.uid,trace.uid);
  assert.deepEqual(hierarchy.groups[0].paths.map(row=>row.uid),[pathRow.uid]);
  assert.deepEqual(hierarchy.orphans.map(row=>row.uid),[otherScopePath.uid]);
});

test('unassigned Paths stay separate instead of attaching by geographic proximity',()=>{
  const hierarchy=traceRouteHierarchy([otherScopePath]);
  assert.equal(hierarchy.groups.length,0);
  assert.deepEqual(hierarchy.orphans.map(row=>row.uid),[otherScopePath.uid]);
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
  assert.match(search,/setStatus\(wasReadingArticle\?'已取消讀取文章。':'已取消搜尋。'\)/);
  assert.match(search,/async function loadGalaxyDetail\(result,signal=null\)/);
  assert.match(search,/signal:controller\.signal/);
  assert.match(search,/if\(id!==searchId\.current\|\|controller\.signal\.aborted\)return;/);
  assert.match(search,/id===searchId\.current&&abortRef\.current===controller/);
  assert.match(search,/ActivityMotion state="cancelled"/);
  const galaxy=await source('app/loc/galaxy/galaxy-query.js');
  assert.match(galaxy,/signal\?\.aborted/);
  assert.match(galaxy,/articleStatisticsContext\(current,day\)\s*\]\);\s*if\(signal\?\.aborted\)/);
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

test('LOC keeps its lightweight cross-Scope route preview separate from annual territory maps',async()=>{
  const preview=await source('app/modular/features/LocTracePreview.jsx');
  const tracePage=await source('app/modular/features/Trace.jsx');
  assert.match(preview,/traceRouteHierarchy/);
  assert.match(preview,/TraceMap publicTrace routeOnly/);
  assert.match(preview,/ScopeLink href=/);
  assert.doesNotMatch(preview,/TraceTerritoryPanel/);
  assert.ok(tracePage.includes("scopeId==='loc'?<LocTracePreview/>"));
  assert.ok(tracePage.includes('TraceTerritoryPanel scopeId={scopeId}'));
});
test('React Motion timing follows the published LOC timing scale',async()=>{
  assert.deepEqual(
    {fast:LOC_MOTION.fast,feedback:LOC_MOTION.feedback,standard:LOC_MOTION.standard,
      emphasis:LOC_MOTION.emphasis,arrival:LOC_MOTION.arrival,ease:LOC_MOTION.ease},
    {fast:.16,feedback:.18,standard:.28,emphasis:.52,arrival:.9,ease:[.22,1,.36,1]}
  );
  const css=await source('app/styles/loc-expressive-ui.css');
  assert.match(css,/--loc-motion-fast:160ms/);
  assert.match(css,/--loc-motion-feedback:180ms/);
  assert.match(css,/--loc-motion-standard:280ms/);
  assert.match(css,/--loc-motion-emphasis:520ms/);
  assert.match(css,/--loc-motion-arrival:900ms/);
  assert.match(css,/--loc-motion-ease:cubic-bezier\(\.22,1,\.36,1\)/);
});

test('Management graph uses vis-network and reads all colors from active theme tokens',async()=>{
  const graph=await source('app/modular/ManagementVisNetwork.jsx');
  assert.match(graph,/import\('vis-network\/esnext'\)/);
  assert.match(graph,/--loc-accent/);
  assert.doesNotMatch(graph,/#(?:[0-9a-f]{3,8})\b|rgba\(/i);
});

test('LOC management uses React selectors for the Time and Space Lucus hierarchies',async()=>{
  const time=await source('app/modular/features/TimeLucusTree.jsx');
  const space=await source('app/loc/trace/SpaceLucusTree.jsx');
  for(const component of [time,space]){
    assert.match(component,/<select className="scope-select"/);
    assert.doesNotMatch(component,/LucusManagementNavigator|ManagementVisNetwork/);
  }
  assert.match(time,/選擇時代/);
  assert.match(time,/選擇期間/);
  assert.match(time,/選擇日期定錨點/);
  assert.match(space,/選擇痕跡圖/);
  assert.match(space,/選擇路徑圖/);
  assert.match(space,/選擇空間定錨點/);
});

test('Home block editing restores the ordered draft list while retaining the current preview',async()=>{
  const editor=await source('app/loc/blocks/ScopeBlockDraftList.jsx');
  assert.match(editor,/visibleDrafts\.map\(\(draft,index\)=>renderDraft\(draft,index,visibleDrafts\)\)/);
  assert.match(editor,/showingPreview\?previewRows/);
  assert.doesNotMatch(editor,/ManagementVisNetwork|loc-home-block-network-editor/);
});

test('Keyword and Space management use React section navigation without duplicating their own graph',async()=>{
  const keyword=await source('app/loc/keywords/ui/KeywordLibraryPanel.jsx');
  const space=await source('app/loc/scope/ScopeManagement.jsx');
  assert.match(keyword,/ManagementSectionNav/);
  assert.match(keyword,/KeywordNetworkEditor/);
  assert.doesNotMatch(keyword,/ManagementNetworkNav/);
  assert.match(space,/ManagementSectionNav/);
  assert.doesNotMatch(space,/ManagementNetworkNav/);
  assert.match(space,/space-management-options\.mjs/);
  assert.doesNotMatch(space,/from ['"]\.\.\/trace\/PlaceManagement['"]/);
  const place=await source('app/loc/trace/PlaceManagement.jsx');
  assert.match(place,/dynamic\(\(\)=>import\('\.\/TimelinePlaceManager'\)/);
  assert.match(place,/from '\.\/space-management-options\.mjs'/);
});

test('Time management Era river uses the same Theme-aware Era color bands as Culture',async()=>{
  const culture=await source('app/modular/features/Culture.jsx');
  const timeline=await source('app/modular/modules/culture-timeline/CultureTimeline.jsx');
  const palette=await source('app/modular/modules/culture-timeline/era-visuals.mjs');
  assert.match(culture,/compactHierarchy\s+paintEraBackground/);
  assert.match(timeline,/paintEraBackground=false/);
  assert.match(timeline,/compactHierarchy&&!paintEraBackground/);
  assert.match(timeline,/paintCultureRows\(rows,cultureEraVisuals\(source\)\)/);
  assert.match(palette,/scope-era-background/);
});
