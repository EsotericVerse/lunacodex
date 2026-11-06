import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {existsSync,readFileSync} from 'node:fs';
import {
  filterTraceAnchorsByText,addTraceAnchorSelection,removeTraceAnchorSelection
} from '../app/loc/trace-bulk-anchor-filter.mjs';

const pathOf=path=>new URL('../'+path,import.meta.url);
const read=path=>readFileSync(pathOf(path),'utf8');

test('Trace guest read path never requires Clerk token',()=>{
  const code=read('app/modular/features/trace/trace-data.js');
  assert.equal((code.match(/const readClient=includeHidden\?dbAuthClient:dbPublicClient;/g)||[]).length,2,
    'both list and selected-point public readers must choose anonymous transport');
  assert.match(code,/readClient\.schema\('silver'\)\.from\(id\+'_anchor'\)/);
  assert.match(code,/readClient\.schema\('silver'\)\.from\(id\+'_trace'\)/);
});

test('bulk Trace saving keeps the reloaded anchor query instead of clearing it',()=>{
  const ui=read('app/loc/TraceManagement.jsx');
  assert.match(ui,/const refreshed=await reload\(\)/);
  assert.match(ui,/!Array\.isArray\(refreshed\?\.anchors\)/);
  assert.doesNotMatch(ui,/cache\.invalidate\(\{queryKey:traceKey\(scopeId\)\}\)/);
  assert.match(ui,/query\.isPending\|\|query\.data===undefined/);
  assert.match(ui,/const spatial=query\.data;/);
  assert.match(ui,/cache\.invalidate\(\{queryKey:traceAllAnchorsKey\(scopeId\)\}\)/);
  const db=read('app/loc/db-client.mjs');
  const adapter=read('app/loc/unified-anchor-compat.mjs');
  assert.match(db,/unified\?unifiedAnchorRelation\(cloudSchema,unified\):cloudSchema\.from\(table\)/);
  assert.match(adapter,/matched\[1\]!=='lo3rwang'/);
  assert.match(adapter,/trace:\['point','path','trace'\]/);
});

test('bulk spatial anchor text search filters the active Scope and selects all matching UIDs without clearing other choices',()=>{
  const anchors=[
    {uid:'Aa12Zx90',title:'板橋車站',postal_address:'新北市板橋區',description:'鐵路'},
    {uid:'Bb12Zx90',title:'板橋小店',postal_address:'新北市',description:'飲料'},
    {uid:'Cc12Zx90',title:'臺北市府',postal_address:'信義區',description:'板橋辦公往返'},
    {uid:'Dd12Zx90',title:'高雄車站',postal_address:'高雄',description:''}
  ];
  assert.deepEqual(filterTraceAnchorsByText(anchors,'板橋').map(row=>row.uid),
    ['Aa12Zx90','Bb12Zx90','Cc12Zx90']);
  assert.deepEqual(filterTraceAnchorsByText(anchors,'  車站 ').map(row=>row.uid),
    ['Aa12Zx90','Dd12Zx90']);
  assert.deepEqual(filterTraceAnchorsByText(anchors,'aa12zx90').map(row=>row.uid),
    ['Aa12Zx90']);
  assert.deepEqual(filterTraceAnchorsByText(anchors,'zzz'),[]);
  assert.equal(filterTraceAnchorsByText(anchors,'').length,4);
  const selected=['Dd12Zx90'];
  const matched=filterTraceAnchorsByText(anchors,'板橋');
  const added=addTraceAnchorSelection(selected,matched);
  assert.deepEqual(added,['Dd12Zx90','Aa12Zx90','Bb12Zx90','Cc12Zx90']);
  assert.deepEqual(addTraceAnchorSelection(added,matched),added,'repeat selection is idempotent');
  assert.deepEqual(removeTraceAnchorSelection(added,matched),selected);
  assert.deepEqual(selected,['Dd12Zx90'],'original selection is not mutated');
  const editor=read('app/loc/TraceManagement.jsx');
  assert.match(editor,/filteredBulkAnchors=useMemo\(\(\)=>filterTraceAnchorsByText\(ownAnchors,bulkFilter\)/);
  assert.match(editor,/>勾選全部符合結果<\/button>/);
  assert.match(editor,/>取消符合結果勾選<\/button>/);
  assert.match(editor,/filteredBulkAnchors\.map\(row=>/);
  assert.match(editor,/onClick=\{\(\)=>bulkApply\(true\)\}/);
  assert.match(editor,/onClick=\{\(\)=>bulkApply\(false\)\}/);
});

test('Trace owns its route and Hero; explanatory Blocks remain in Search',()=>{
  const app=read('app/loc/LocApp.jsx');
  const feature=read('app/modular/features/Trace.jsx');
  const search=read('app/modular/features/Search.jsx');
  const blocks=read('app/modular/features/TraceBlocks.jsx');
  assert.match(app,/trace:Trace/);
  assert.match(feature,/<FeaturePage featureId="trace">/);
  assert.match(feature,/<TraceMap publicTrace floatingControls=\{floatingControls\}/);
   assert.match(feature,/onAnchorSelect=\{chooseMapAnchor\}/);
  assert.match(feature,/enabled:supported&&routeListOpen/);
  assert.match(search,/import\('\.\/TraceBlocks'\)/);
  assert.match(blocks,/page="trace"/);
  assert.match(blocks,/trace-grid/);
  assert.doesNotMatch(feature,/ScopeEditableBlocks|selectGalaxy|updateRows/);
});

test('Navigation places Trace before Search and gives it an independent icon',()=>{
  const registry=read('app/modular/scope-registry.js');
  const shell=read('app/AppShell.jsx');
  const icons=read('app/modular/BottomNavIcon.jsx');
  assert.match(registry,/id:'trace'.*path:'trace'/);
  assert.match(shell,/\['culture','statics','trace','search'\]/);
  assert.match(icons,/if\(name==='trace'\)/);
  assert.match(shell,/editTabHref\('search\/manage'/);
  assert.match(shell,/editTabHref\('statics\/manage'/);
  for(const [file,label] of [
    ['zh_tw.js','痕跡'],['zh_cn.js','痕迹'],['en.js','Traces'],['ja.js','軌跡']
  ]){
    const locale=read('app/i18n/'+file);
    const section=locale.split('"trace": {')[1]?.split('},')[0]||'';
    assert.ok(section.includes('"title": "'+label+'"'),file+' trace title');
  }
});

test('MapLibre is lazy and has neither paid search nor floor geometry',()=>{
 const engine=read('app/modular/features/trace/trace-map-engine.js');
 const react=read('app/modular/features/trace/TraceMap.jsx');
 assert.match(engine,/from 'maplibre-gl'/);
 assert.match(react,/import 'maplibre-gl\/dist\/maplibre-gl\.css'/);
 assert.match(react,/createTraceMap\(containerRef\.current/);
 assert.match(engine,/loc-trace-saved-anchors/);
 assert.doesNotMatch(engine,/floor_level|floor_label|loc-trace-picked-area|setRadius/);
 assert.doesNotMatch(engine,/searchTracePlaces|nominatim|photon/);
});

test('MapLibre click stores optional GPS without county or floor',()=>{
 const engine=read('app/modular/features/trace/trace-map-engine.js');
 const ui=read('app/loc/TraceManagement.jsx');
 assert.match(ui,/onLocationPick=\{\(\{lng,lat,name\}\)=>\{/);
 assert.match(ui,/if\(name\)setTitle\(t=>t\.trim\(\)\|\|name\)/);
 assert.match(ui,/文字地址（非必填）/);
 assert.match(engine,/map\.on\('click',event=>pickLocation/);
 assert.doesNotMatch(ui,/countyOptions|floor_level/);
});

test('Only canonical public Trace and management routes exist',()=>{
  for(const path of [
    'app/trace/page.jsx','app/lrunes/trace/page.jsx',
    'app/lo3rwang/trace/page.jsx','app/scope-shell/trace/page.jsx'
  ])assert.match(read(path),/forcedView="trace"/,path);
  for(const path of [
    'app/trace/manage/page.jsx',
    'app/lrunes/manage/page.jsx','app/lo3rwang/manage/page.jsx',
    'app/scope-shell/manage/page.jsx'
  ])assert.match(read(path),/forcedView="manage"/,path);
  for(const path of [
    'app/lrunes/search/manage/page.jsx','app/lo3rwang/search/manage/page.jsx',
    'app/scope-shell/search/manage/page.jsx','app/search/manage/page.jsx'
  ])assert.match(read(path),/forcedView="searchManage"/,path);
  assert.match(read('app/admin/page.jsx'),/forcedScope="admin"/);
  for(const prefix of [
    'app/governance','app/lrunes/governance',
    'app/lo3rwang/governance','app/scope-shell/governance','app/local/governance'
  ])assert.ok(!existsSync(pathOf(prefix+'/page.jsx')),prefix+' must be absent');
  assert.match(read('app/sitemap.js'),/\/trace/);
  const core=read('app/modular/published-blocks/index.js');
  assert.match(core,/"loc:trace"/);
  assert.match(core,/"loc:scope_trace"/);
  // group_trace is the sole authoritative Trace Hero. No governance alias.
  assert.match(core,/"loc:group_trace"/);
  assert.doesNotMatch(core,/"loc:group_governance"/);
});

test('review-first Facebook place backfill remains separate from Trace edits',()=>{
 const editor=read('app/loc/PlaceBatchFill.jsx'),ui=read('app/loc/TraceManagement.jsx');
 assert.match(editor,/p_apply:false/);
 assert.match(editor,/p_apply:true,p_expected_count:count/);
 assert.match(editor,/window\.confirm\(/);
 assert.match(ui,/編輯既有地點（直接搜尋標題）/);
 assert.match(ui,/updateTraceAnchor/);
});

test('paid third-party place geocoding is absent from all Trace surfaces',()=>{
 const mgr=read('app/loc/ScopeManagement.jsx');
 const editor=read('app/loc/TraceManagement.jsx');
 const map=read('app/modular/features/trace/TraceMap.jsx');
 assert.doesNotMatch(mgr,/traceGeocode|TracePlaceGeocoder/);
 assert.doesNotMatch(editor,/searchTracePlaces|quickLocate|trace-geocoding/);
 assert.doesNotMatch(map,/searchTracePlaces|lookupPlace|photon|nominatim/);
 assert.ok(!existsSync(pathOf('app/loc/TracePlaceGeocoder.jsx')));
 assert.ok(!existsSync(pathOf('app/modular/features/trace/trace-geocoding.js')));
 assert.match(mgr,/value:'placeManage'/);
 assert.match(read('app/loc/PlaceManagement.jsx'),/mode="cleanup"/);
});
test('Frame Queue uses existing selected UIDs with no county prerequisite',()=>{
 const ui=read('app/loc/TraceRouteManager.jsx');
 const db=read('app/modular/features/trace/trace-data.js');
 assert.match(ui,/import Select from 'react-select'/);
 assert.match(ui,/onClick=\{addToSpool\}/);
 assert.match(ui,/onClick=\{addRoadStop\}/);
 assert.match(ui,/readAllTraceAnchors\(owner/);
 assert.doesNotMatch(ui,/countyOptions|readTraceAddressReferences|createReferenceAnchor/);
 assert.match(db,/path/);
});

test('Public Trace presents on-demand selected-place articles / Culture / Statistics',()=>{
  const feature=read('app/modular/features/Trace.jsx');
  const map=read('app/modular/features/trace/TraceMap.jsx');
  const engine=read('app/modular/features/trace/trace-map-engine.js');
  const results=read('app/modular/features/trace/TracePlaceResults.jsx');
  assert.match(feature,/readTraceMapIndex\(scopeId\)/);
  assert.match(feature,/目前顯示（痕跡圖聯集）/);
  assert.ok(feature.indexOf('const periodScopeId=')>=0&&
    feature.indexOf('const periodScopeId=')<feature.indexOf('useEffect(()=>{setDemoStopIds([]);},[periodScopeId'),
    'derived Scope must be initialized before any effect dependency accesses it');
  assert.match(feature,/readCurrentTraceAnchors\(periodScopeId,members,/);
  assert.match(feature,/nativeOnly:periodScopeId==='loc'/);
  assert.match(feature,/onAnchorSelect=\{chooseMapAnchor\}/);
  assert.match(feature,/<TracePlaceResults key=\{reportPlace\.source_scope/);
   assert.match(feature,/place=\{reportPlace\}/);
   assert.match(feature,/role="dialog" aria-modal="false"/);
   assert.match(feature,/className="loc-trace-float-report"/);
  assert.match(feature,/\{value:'articles',label:'文章列表'\}/);
  assert.match(feature,/\{value:'timeline',label:'時間長河'\}/);
  assert.match(feature,/\{value:'statistics',label:'統計圖'\}/);
  assert.match(engine,/map\.on\('click',layer,chooseAnchor\)/);
  assert.match(map,/onAnchorSelect:!selectingLocation\?anchor=>/);
  assert.match(results,/traceArticleIdFilters\(placeIds,/);
  assert.match(results,/<CultureTimeline items=\{riverItems\}/);
  assert.match(results,/<StatisticsMultiChart type=\{chartType\}/);
  assert.doesNotMatch(feature,/featureNavigationHref|router\.push/);
});

test('Search recommendations execute real queries and only suggest loaded place names',()=>{
  const search=read('app/modular/features/Search.jsx');
  const blocks=read('app/loc/ScopeEditableBlocks.jsx');
  assert.match(search,/function searchFromSuggestion\(/);
  assert.match(search,/onSuggestionClick=\{term=>searchFromSuggestion\(term\)\}/);
  assert.match(search,/executeSearch\(term,null,\{overrideOptions:/);
  assert.doesNotMatch(search,/suggestedPlaces=useMemo\(/);
  assert.doesNotMatch(search,/searchFromSuggestion\(place,\{placeOnly:true/);
  assert.match(search,/<datalist id="scope-search-loaded-titles">/);
  assert.match(blocks,/blocksToPlainText\(html\)\.split/);
  assert.match(blocks,/!slot\.entities\.some\(entity=>recommendationTerm\(entity\.text\)\)/);
});

test('Trace loads only Frame metadata at entry; content modes remain scoped and lazy',()=>{
  const trace=read('app/modular/features/Trace.jsx');
  const panel=read('app/modular/features/trace/TracePlaceResults.jsx');
  const filters=read('app/modular/features/trace/trace-panel-filters.mjs');
  const culture=read('app/modular/features/Culture.jsx');
  const stats=read('app/modular/features/Statistics.jsx');
  assert.match(trace,/\[routeListOpen\]=useState\(true\)/);
  assert.match(trace,/enabled:supported&&routeListOpen/);
  assert.match(trace,/\[timeWindow,setTimeWindow\]=useState\('all'\)/);
  assert.match(trace,/\[reportTab,setReportTab\]=useState\(null\)/);
  assert.match(trace,/sourceName=\{sourceName\} mediaType=\{mediaType\}/);
  assert.match(filters,/traceWindow\(window='3m'/);
  assert.match(panel,/site/);
  assert.match(panel,/sourceFilter/);
  // Culture owns its direct Time structure; only Statistics retains the
  // dedicated Period-navigation cache. Trace must not require either ISR.
  assert.ok(culture.includes("queryKey:['culture-timeline',scopeId]"));
  assert.match(stats,/queryKey:\['culture-time-periods',scopeId\]/);
});

test('Culture and Statistics share the source projection of Universe Tree',()=>{
  const catalog=read('app/modular/published-source-taxonomy.js');
  const culture=read('app/modular/features/Culture.jsx');
  const stats=read('app/modular/features/Statistics.jsx');
  const sourceNames=read('app/loc/source-classification.mjs');
  assert.match(catalog,/publishedSourceCategoryCatalog/);
  assert.match(catalog,/sourceTreeFromArrays/);
  assert.match(catalog,/sourceSiteKeyForLabel/);
  assert.doesNotMatch(catalog,/SOURCE_DISPLAY_ALIASES/);
  assert.match(sourceNames,/sourceTreeFromArrays/);
  assert.match(sourceNames,/SOURCE_KEYWORD_LEVELS/);
  assert.match(culture,/const publishedTaxonomy=useMemo\(\(\)=>publishedSourceTaxonomy\(scopeId\),\[scopeId\]\)/);
  assert.match(culture,/enabled:!publishedTaxonomy/);
  assert.match(stats,/publishedSourceCategoryCatalog\(scopeId\)/);
  assert.match(stats,/enabled:sourceChart&&Boolean\(scopeId\)&&!publishedCatalog/);
  assert.match(stats,/if\(isLrunesDaily\|\|mediaDimension\|\|!sourceCatalog.isSuccess\)return null/);
  assert.match(sourceNames,/sourceTaxonomyFromArrays/);
  assert.doesNotMatch(catalog,/statistics_source_categories|statistics_scope_others_groups/);
});

test('Trace overview computes bounds from saved space_anchor coordinates',()=>{
 const engine=read('app/modular/features/trace/trace-map-engine.js');
 assert.match(engine,/function overview\(\)\{/);
 assert.match(engine,/\.filter\(isValidSavedAnchor\)/);
 assert.match(engine,/map\.fitBounds\(bounds/);
 assert.match(engine,/anchor\?\.trace_type!=='space_anchor'/);
});

test('Trace map resizes with mouse or keyboard while remaining inside the desktop and phone main frame',()=>{
  const map=read('app/modular/features/trace/TraceMap.jsx');
  const engine=read('app/modular/features/trace/trace-map-engine.js');
  const css=read('app/styles/features.css');
  assert.match(css,/\.loc-next-main:has\(\.loc-trace-panel\)/);
  assert.match(css,/\.loc-next-main:has\(\.loc-trace-panel\)\{min-width:0;max-width:100%;overflow-x:clip\}/);
  assert.match(css,/\.loc-trace-resize-tools\{display:none\}/);
  assert.match(css,/\(min-width:900px\) and \(pointer:fine\)/);
  assert.match(css,/\.loc-trace-map-frame\{[\s\S]*?height:clamp\(460px,68svh,820px\)/);
  assert.match(css,/@media\(max-width:680px\)/);
  assert.match(css,/height:clamp\(400px,62svh,690px\)/);
  assert.match(map,/ResizeObserver\(\(\)=>mapRef\.current\?\.resize\(\)\)/);
  assert.match(engine,/resize:\(\)=>\{if\(!removed\)map\.resize\(\);\}/);
  assert.match(map,/onPointerDown=\{startMapResize\}/);
  assert.match(map,/onPointerMove=\{moveMapResize\}/);
  assert.match(map,/onPointerUp=\{stopMapResize\}/);
  assert.match(map,/onKeyDown=\{keyboardMapResize\}/);
  assert.match(map,/spatialData\?\.anchors\?\.some\(/);
  assert.match(map,/selectingLocation\?copy\.examples:copy\.all/);
});

test('Trace homepage only reads selected saved route points and never all points',()=>{
  const trace=read('app/modular/features/Trace.jsx');
  const data=read('app/modular/features/trace/trace-data.js');
  assert.match(trace,/enabled:supported&&routeListOpen&&traceIndex\.data!==undefined&&Boolean\(currentMap\)/);
  assert.match(trace,/queryFn:\(\)=>readCurrentTraceAnchors\(periodScopeId,members,/);
  assert.doesNotMatch(trace,/readAllTraceAnchors\(/);
  assert.doesNotMatch(trace,/traceAllAnchorsKey\(/);
  assert.match(trace,/if\(!currentMap\)return \{anchors:\[\],maps:\[\]\}/);
  assert.match(data,/types:\['path','trace'\]/);
  const map=read('app/modular/features/trace/TraceMap.jsx');
  assert.match(map,/autoOverviewScopeRef\.current===scope/);
});

test('public guest can preview exactly two map points without any mutation API',async()=>{
 const {pickTraceDemoStop,traceDemoRoute}=await import('../app/modular/features/trace/trace-demo-route.mjs');
 const row=(uid,title,scope='lo3rwang',address=[121.5,25.1])=>({
   uid,title,source_scope:scope,trace_type:'space_anchor',address});
 const [a,b,c]=[row('A001','起點'),row('B002','終點'),row('C003','第三點')];
 let selected=pickTraceDemoStop([],a,'lo3rwang');
 assert.deepEqual(selected,['A001']);
 selected=pickTraceDemoStop(selected,b,'lo3rwang');
 assert.deepEqual(selected,['A001','B002']);
 assert.deepEqual(pickTraceDemoStop(selected,c,'lo3rwang'),selected);
 assert.deepEqual(pickTraceDemoStop(selected,b,'lo3rwang'),selected);
 const preview=traceDemoRoute(selected,[a,b,c],'lo3rwang');
 assert.equal(preview.uid,'DEMO');
 assert.equal(preview.trace_type,'path');
 assert.deepEqual(preview.anchor_list,['A001','B002']);
 assert.equal(traceDemoRoute(['A001','C003'],[a,b],'lo3rwang'),null);
 assert.deepEqual(pickTraceDemoStop([],row('X001','跨 Scope','lrunes'),'lo3rwang'),[]);
 assert.deepEqual(pickTraceDemoStop([],row('X001','無座標','lo3rwang',null),'lo3rwang'),[]);
 const publicPage=read('app/modular/features/Trace.jsx');
 assert.match(publicPage,/兩點路線試玩（不儲存）/);
 assert.match(publicPage,/onAnchorSelect=\{chooseMapAnchor\}/);
 assert.match(publicPage,/selectedRouteUid=\{twoPointDemo\?/);
 assert.doesNotMatch(publicPage,/addTraceMap|updateTraceMap|deleteTraceMap/);
});

test('Trace only loads article content after a map anchor click and displays report inside map',()=>{
  const page=read('app/modular/features/Trace.jsx');
  const map=read('app/modular/features/trace/TraceMap.jsx');
  const engine=read('app/modular/features/trace/trace-map-engine.js');
  const styles=read('app/styles/features.css');
  assert.match(page,/const reportPlace=twoPointDemo\?null:\(selectedAvailable\?selectedPlace:null\)/);
  assert.match(page,/<TraceMap publicTrace floatingControls=\{floatingControls\}/);
  assert.match(page,/\{reportPlace\?<div className="loc-trace-float-report"/);
  assert.match(page,/onClick=\{\(\)=>\{setSelectedPlace\(null\);setReportTab\(null\);\}\}>×<\/button>/);
  assert.match(page,/<TracePlaceResults key=\{reportPlace\.source_scope/);
  assert.doesNotMatch(page,/reportTopRef|scrollIntoView|setMapOnly|!mapOnly&&reportPlace/);
  assert.match(map,/publicTrace&&children\?<div className="loc-trace-floating-content"/);
  assert.match(map,/showAnchorPopup:!publicTrace/);
  assert.match(engine,/if\(showAnchorPopup\)new Popup/);
  assert.match(styles,/\.loc-trace-map-shell\.is-public-trace>\.loc-trace-map-frame/);
  assert.match(styles,/calc\(100dvh - 8rem\)/);
});

test('mobile Trace keeps selected-place report clear of the map return button',()=>{
  const css=read('app/styles/responsive.css');
  assert.match(css,/\.loc-trace-map-shell\.is-public-trace \.loc-trace-floating-content\{/);
  assert.match(css,/bottom:calc\(3\.65rem \+ env\(safe-area-inset-bottom,0px\)\)/);
  assert.match(css,/top:clamp\(10rem,35%,14rem\)/);
  assert.match(css,/max-height:none/);
  assert.match(css,/\.loc-trace-map-shell\.is-public-trace \.loc-trace-origin-button\{/);
  assert.match(css,/min-height:44px/);
  assert.match(css,/max-height:min\(42dvh,280px\)/);
});

test('all four article lists show saved dates and shared theme-alternating rows',()=>{
  const article=read('app/modular/Article.jsx');
  const statistics=read('app/modular/features/Statistics.jsx');
  const culture=read('app/modular/features/Culture.jsx');
  const search=read('app/modular/features/Search.jsx');
  const trace=read('app/modular/features/trace/TracePlaceResults.jsx');
  const stripes=read('app/styles/list-stripes.css');
  assert.ok(article.includes("String(date||articleDate||articleCreateTime||'').slice(0,10)"));
  assert.ok(statistics.includes('date={work.date||work.createtime||work.start_date||'));
  assert.ok(culture.includes('日期：{work.date}'));
  assert.ok(search.includes('date={row.date}'));
  assert.ok(trace.includes('date={row.date||row.createtime||'));
  assert.ok(trace.includes("columns:'uid,title,createtime,date'"));
  assert.ok(stripes.includes('.loc-public-article-list > :is(.scope-work-list-row,.loc-shared-work-card):nth-child(odd)'));
  assert.ok(stripes.includes('background:var(--loc-list-row-even)'));
});

test('public Trace report fits the map and keeps its three mode buttons in one row',()=>{
  const styles=read('app/styles/features.css');
  assert.ok(styles.includes('.loc-trace-float-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))'));
  assert.ok(styles.includes('top:clamp(9rem,28%,12rem);max-height:none;min-height:0;'));
});

test('Trace place deeplink focuses Anchor without mounting Galaxy article list',()=>{
 const page=read('app/modular/features/Trace.jsx');
 const map=read('app/modular/features/trace/TraceMap.jsx');
 assert.match(page,/focusLocation=\{deepLinkedPlace\.data\|\|null\}/);
 assert.match(page,/if\(!spatialData\|\|!anchor\?\.uid\|\|spatialData\.anchors\.some/);
 assert.doesNotMatch(page,/setReportTab\('articles'\)/);
 assert.match(page,/\{reportTab\?<TracePlaceResults/);
 assert.match(map,/if\(ready&&focusLocation\)mapRef\.current\?\.focusCoordinates\(focusLocation\)/);
});
