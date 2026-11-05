import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import vm from 'node:vm';
import {administrativeSourceTrend} from '../app/loc/statistics-admin-source.mjs';
import {MAX_ROWS} from '../app/loc/query-batch-size.mjs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

// Test the real public bootstrap entry without loading browser-only SDKs.
// Mock only its database seams; assert the publicly observable requests and
// result rather than relying on wall-clock network timing.
const source=readFileSync(new URL('../app/loc/app-bootstrap.js',import.meta.url),'utf8');

async function harness(){
  const calls=[];
  let resolveSite;
  let rejectSite;
  let siteResponse=new Promise((resolve,reject)=>{resolveSite=resolve;rejectSite=reject;});
  const site={config:{id:'loc',theme:'theme-7'},blocks:[{uid:'loc-block'}],registry:[],page_copy:[],themes:[],theme_list:[]};
  const context=vm.createContext({Promise,Date});
  const stub={
    './use-async-resource':{useAsyncResource:()=>({})},
    './db-client.mjs':{dbPublicClient:{}},
    './scope-data':{
      invalidatePublicScopeMetadata:()=>{},
      invalidatePublicThemeSnapshot:()=>{},
      selectPublicSiteBootstrap:()=>{calls.push('site');return siteResponse;},
      selectScopeBlocks:(id,page)=>{calls.push('blocks:'+id+':'+page);return Promise.resolve([{uid:id+'-'+page}]);},
      selectScopeConfig:id=>{calls.push('config:'+id);return Promise.resolve({id,display_name:id});},
      selectScopeRegistry:()=>Promise.resolve([])
    },
    './theme-data':{selectThemeRegistry:()=>Promise.resolve([]),themeUiId:id=>id}
  };
  const modules=new Map(Object.entries(stub).map(([name,values])=>[
    name,new vm.SyntheticModule(Object.keys(values),function(){
      for(const [key,value] of Object.entries(values))this.setExport(key,value);
    },{context,identifier:name})
  ]));
  const module=new vm.SourceTextModule(source,{context,identifier:'app-bootstrap.js'});
  await module.link(name=>{
    const dependency=modules.get(name);
    if(!dependency)throw new Error('Unexpected import: '+name);
    return dependency;
  });
  await module.evaluate();
  return {calls,site,resolveSite,selectAppBootstrap:module.namespace.selectAppBootstrap};
}

test('non-LOC public Config and blocks begin alongside site Bootstrap',async()=>{
  const {calls,site,resolveSite,selectAppBootstrap}=await harness();
  const pending=selectAppBootstrap('lo3rwang','search');
  assert.deepEqual(calls,['site','config:lo3rwang','blocks:lo3rwang:search'],
    'Scope reads must not wait for the site RPC to finish');
  resolveSite(site);
  const result=await pending;
  assert.equal(result.config.id,'lo3rwang');
  assert.equal(result.blocks[0].uid,'lo3rwang-search');
  assert.deepEqual(result.registry,[]);
});

test('local iPhone Scope reads config and blocks without cloud site bootstrap',async()=>{
  const {calls,selectAppBootstrap}=await harness();
  const result=await selectAppBootstrap('local','search');
  assert.deepEqual(calls,['config:local','blocks:local:search']);
  assert.equal(result.config.id,'local');
  assert.equal(result.blocks[0].uid,'local-search');
  // This array originates in vm.SourceTextModule's separate realm.
  assert.equal(result.registry.length,0);
});

test('Admin consumes site metadata without querying nonexistent admin tables',async()=>{
  const {calls,site,resolveSite,selectAppBootstrap}=await harness();
  const pending=selectAppBootstrap('admin','index');
  assert.deepEqual(calls,['site']);
  resolveSite(site);
  const result=await pending;
  assert.equal(result.config,null);
  assert.equal(result.blocks.length,0);
});

test('LOC homepage gets published Blocks independently of the shared metadata',async()=>{
  const {calls,site,resolveSite,selectAppBootstrap}=await harness();
  const pending=selectAppBootstrap('loc','index');
  assert.deepEqual(calls,['site','blocks:loc:index']);
  resolveSite(site);
  const result=await pending;
  assert.equal(result.config.id,'loc');
  assert.equal(result.blocks[0].uid,'loc-index');
});

// Regression: choosing a keyword source must update the main time series and
// the total without counting multimedia from unrelated source categories.
test('author keyword source filters the main chart without changing all-source totals',()=>{
  const taxonomy={
    categories:[
      {category_code:'facebook',display_name:'Facebook',enabled:true},
      {category_code:'threads',display_name:'Threads',enabled:true}
    ],
    aliases:[
      {source_key:'FB',category_code:'facebook'},
      {source_key:'Threads',category_code:'threads'}
    ]
  };
  const raw=[
    {day:'2026-10-21',kind:'total',category:'文字作品',item_count:5},
    {day:'2026-10-21',kind:'total',category:'多媒體',item_count:2},
    {day:'2026-10-21',kind:'source',category:'FB',item_count:3},
    {day:'2026-10-21',kind:'source',category:'Threads',item_count:2},
    {day:'2026-10-22',kind:'total',category:'文字作品',item_count:2},
    {day:'2026-10-22',kind:'total',category:'多媒體',item_count:1},
    {day:'2026-10-22',kind:'source',category:'fb',item_count:1},
    {day:'2026-10-22',kind:'source',category:'Threads',item_count:1}
  ];
  const range={startDate:'2026-10-21',endDate:'2026-10-22'};
  const all=administrativeSourceTrend(raw,taxonomy,range);
  assert.equal(all.total,10);
  assert.equal(all.series.length,2);
  const facebook=administrativeSourceTrend(raw,taxonomy,{...range,sourceCategory:'facebook'});
  assert.equal(facebook.total,4);
  assert.deepEqual(facebook.rows.map(row=>row.total),[3,1]);
  assert.deepEqual(facebook.rows.map(row=>row.category_facebook),[3,1]);
  assert.deepEqual(facebook.series,[{key:'category_facebook',label:'Facebook'}]);
  assert.deepEqual(facebook.distribution,[{name:'Facebook',value:4}]);
  const threads=administrativeSourceTrend(raw,taxonomy,{...range,sourceCategory:'threads'});
  assert.equal(threads.total,3);
  assert.deepEqual(threads.rows.map(row=>row.total),[2,1]);
  assert.equal(administrativeSourceTrend(raw,taxonomy,range).total,10);
  const subgroup=administrativeSourceTrend(raw,taxonomy,{...range,sourceCategory:'facebook',sourceNames:['fb']});
  assert.equal(subgroup.total,4);
  assert.equal(administrativeSourceTrend(raw,taxonomy,{...range,sourceCategory:'facebook',sourceNames:[]}).total,0);
});

test('statistics uses one flat source selector and no retired classification tables',()=>{
  const code=readFileSync(new URL('../app/modular/features/Statistics.jsx',import.meta.url),'utf8');
  const editor=readFileSync(new URL('../app/loc/FlatClassificationEditor.jsx',import.meta.url),'utf8');
  assert.match(code,/const activeSourceSelection=styleFilter==='rune66'/);
  assert.match(code,/作品／個人分類/);
  assert.doesNotMatch(code,/sourceSubgroup|statistics_scope_others_groups|statistics_scope_others_aliases/);
  assert.match(editor,/update\(\{\[scopeTagColumn\(scopeId\)\]:names\}\)/);
  assert.doesNotMatch(editor,/group_code|category_code|source_key/);
});

test('keyword charts share one canvas and intersections offer at most eight lanes',async()=>{
  const chart=readFileSync(new URL('../app/modular/modules/statistics/StatisticsMultiChart.jsx',import.meta.url),'utf8');
  const pane=readFileSync(new URL('../app/modular/modules/statistics/ScopeSelfIntersection.jsx',import.meta.url),'utf8');
  assert.equal(chart.match(/<StatisticsMultiChart type=\{actualChart\}/g)?.length,1);
  assert.match(chart,/群組＋項目（同圖）/);
  assert.match(chart,/value:Number\(row.document_count\)/);
  assert.match(pane,/maximumLanes=Math.min\(8,/);
  assert.match(pane,/kind:'keyword_group'/);
  assert.match(pane,/kind:'keyword_item'/);
  assert.match(pane,/kind:'others_subgroup'/);
  const {color,pointColor,normalizeDistribution}=await import('../app/modular/modules/statistics/statistics-time-zoom.mjs');
  assert.equal(new Set(Array.from({length:8},(_,i)=>color(i))).size,8);
  assert.equal(new Set(Array.from({length:48},(_,i)=>pointColor(i))).size,48);
  assert.equal(pointColor(25),pointColor(25));
  assert.equal(normalizeDistribution([{name:'群組',value:3,fill:'#8962e3'}])[0].fill,'#8962e3');
  // The primary graph uses multiple series; each displayed bar, not merely
  // each series, needs a Cell with its own color.
  assert.match(chart,/display\.map\(\(_,j\)=><Cell key=\{j\} fill=\{pointColor\(j\*timeFields\.length\+i\)\}/);
  assert.match(chart,/composed\.map\(\(_,i\)=><Cell key=\{i\} fill=\{pointColor\(i\)\}/);
  assert.match(chart,/colorPanel=\{colored\.map\(item=>item\.fill\)\}/);
  assert.match(chart,/paired\.data\.map\(\(row,i\)=><Cell key=/);
  assert.match(chart,/fields\.length>1&&!\['bar','composed'\]\.includes\(actual\)/);
});


test('keyword combined ranking follows actual Class membership and keeps pagination',()=>{
  const source=readFileSync(new URL('../app/modular/modules/statistics/StatisticsMultiChart.jsx',import.meta.url),'utf8');
  const start=source.indexOf('  const classByGroup=new Map(');
  const end=source.indexOf('  const trend=keywordGroupTrend(',start);
  assert.ok(start>0&&end>start,'grouped ranking model must exist');
  const model=new Function('meta','groupCatalog','classRows','groupRows','shown','page',
    'standalonePageSize','combinedPageSize','groupLabel','t','color','classLabel',
    source.slice(start,end)+
    'return {pages,visibleCombined,visibleGroupRows,combinedDistribution};');
  const meta={classes:{GR07:'秩序',GR02:'連結'}};
  const groupCatalog={data:Array.from({length:12},(_,i)=>({
    uid:'IT'+String(i).padStart(2,'0'),class_group:i<8?'秩序':'連結'
  }))};
  const classRows=[
    {group_uid:'GR07',group:'秩序',document_count:20},
    {group_uid:'GR02',group:'連結',document_count:10}
  ];
  const groupRows=Array.from({length:12},(_,i)=>({
    uid:'IT'+String(i).padStart(2,'0'),label:'符文'+(i+1),count:100-i,document_count:50-i
  }));
  const select=(shown,page)=>model(meta,groupCatalog,classRows,groupRows,shown,page,8,10,
    label=>label,value=>value,index=>'color'+index,label=>label);
  const first=select('both',1),second=select('both',2);
  assert.equal(first.visibleCombined.length,10);
  assert.equal(second.visibleCombined.length,2);
  assert.equal(first.visibleCombined[0].classification.group_uid,'GR07');
  assert.equal(first.visibleCombined[8].classification.group_uid,'GR02');
  assert.match(first.combinedDistribution[0].name,/秩序/);
  assert.match(second.combinedDistribution[0].name,/連結/);
  assert.equal([...first.visibleCombined,...second.visibleCombined].length,12);
  assert.equal(select('item',1).visibleGroupRows.length,8);
  assert.equal(select('item',2).visibleGroupRows.length,4);
});


test('advanced statistics uses dimension tabs and two dependent comparison selectors',()=>{
  const source=readFileSync(new URL('../app/modular/modules/statistics/ScopeSelfIntersection.jsx',import.meta.url),'utf8');
  const dimensions=source.slice(source.indexOf('export const DIMENSION_FILTERS='),source.indexOf('export const DIMENSIONS='));
  for(const label of ['全部','作品來源','多媒體','關鍵詞'])assert.ok(dimensions.includes("label:'"+label+"'"));
  assert.equal((dimensions.match(/label:/g)||[]).length,4);
  const ui=source.slice(source.indexOf('<div className="scope-self-intersection-comparisons">'),
    source.indexOf('<div className="scope-stat-controls">',source.indexOf('<div className="scope-self-intersection-comparisons">')));
  assert.ok(ui.includes('Array.from({length:lanes}'));
  assert.equal((ui.match(/<select className="scope-select"/g)||[]).length,2);
  assert.ok(ui.includes('comparisonMetricGroups(kind,{'));
  assert.ok(ui.includes('selectedComparisonMetricGroup(groups,chosenId)'));
  assert.ok(ui.includes('firstAvailableGroupMetric(target,takenByOther)'));
  assert.ok(ui.includes('scope-self-intersection-kind-tabs'));
  assert.ok(ui.includes("+' 類別'"));
  assert.ok(ui.includes("+' 項目'"));
  assert.ok(source.includes('scope-advanced-keyword-catalog'));
  assert.ok(source.includes('readKeywordTreeCatalog(scope.id)'));
  assert.ok(source.includes('item.group===group.group'));
  assert.ok(source.includes("dimensionForKind(item.kind)===shownKinds[index]"));
  assert.ok(source.includes("shownKinds[index]==='all'"));
  assert.ok(source.includes('keywordTabAvailable'));
  assert.ok(source.includes("row.kind==='group_items_day'"));
  assert.ok(source.includes("row.kind==='keyword_all_day'"));
  assert.ok(source.includes('maximumLanes=Math.min(8,'));
  assert.ok(source.includes("kind:'source_rollup'"));
  assert.ok(source.includes("name:'作品分類'"));
  assert.ok(source.includes("name:'個人分類'"));
  assert.ok(source.includes("ids.push('source_rollup'+String.fromCharCode(0)+'system')"));
  const start=source.indexOf('export function mediaTypeFamily(raw)');
  const end=source.indexOf('const MEDIA_GROUP_NAMES=',start);
  const family=new Function(source.slice(start,end).replace('export function','function')+
    'return mediaTypeFamily;')();
  assert.equal(family('suno'),'music');
  assert.equal(family('facebook_pic'),'image');
  assert.equal(family('youtube_video'),'video');
  assert.equal(family('instagram'),'', 'An unspecific platform must not be guessed as image/video');
});

test('Keywords reset clears the current Class rather than writing Galaxy',()=>{
  const contract=readFileSync(new URL('../app/loc/db-contract.mjs',import.meta.url),'utf8');
  const start=contract.indexOf('  async function resetKeywordClassification(');
  const end=contract.indexOf('  async function readKeywordClass(',start);
  assert.ok(start>=0&&end>start);
  const body=contract.slice(start,end);
  assert.match(body,/update\\(\\{uid_lists:\\[\\]\\}\\)/);
  assert.match(body,/\.eq\('uid',row\.uid\)/);
  assert.doesNotMatch(body,/galaxy|group_lists|apply_keyword_classification/);
});

test('keyword panel reads one Scope tree and writes no Galaxy classification',()=>{
  const panel=readFileSync(new URL('../app/loc/KeywordLibraryPanel.jsx',import.meta.url),'utf8');
  assert.match(panel,/dbAuthRelation\(table\)/);
  assert.match(panel,/\.select\('uid,type,name,desc,lists'\)/);
  assert.match(panel,/reanalysis|重新分析/);
  assert.match(panel,/Group／Item/);
  assert.doesNotMatch(panel,/\.update\(\{class_id|group_lists/);
});

test('keyword reset reports progress and edit dock remains in AppShell',()=>{
  const panel=readFileSync(new URL('../app/loc/KeywordLibraryPanel.jsx',import.meta.url),'utf8');
  const shell=readFileSync(new URL('../app/AppShell.jsx',import.meta.url),'utf8');
  const css=readFileSync(new URL('../app/styles/bottom-navigation.css',import.meta.url),'utf8');
  assert.match(panel,/onProgress:setProgress/);
  assert.match(panel,/dock\.register/);
  const notice=shell.indexOf('className="scope-edit-dock-notice"');
  assert.ok(notice>0);
  assert.ok(shell.indexOf('</nav>',notice)>notice);
  assert.ok(css.includes('.scope-feature-dock .scope-edit-dock-notice{'));
});

test('Web Settings cannot navigate into the iOS-only local Scope',()=>{
  const settings=readFileSync(new URL('../app/loc/GlobalSettings.jsx',import.meta.url),'utf8');
  const shell=readFileSync(new URL('../app/AppShell.jsx',import.meta.url),'utf8');
  const locApp=readFileSync(new URL('../app/loc/LocApp.jsx',import.meta.url),'utf8');
  const scopeRegistry=readFileSync(new URL('../app/modular/scope-registry.js',import.meta.url),'utf8');
  assert.ok(scopeRegistry.includes('nativeOnly:true'));
  assert.ok(settings.includes("if(native)baseChoices.push({id:'local'"));
  assert.ok(settings.includes("(!native&&getScope(row.scope_id).nativeOnly)"));
  assert.ok(settings.includes("...(native&&Capacitor.getPlatform()==='ios'?[option('files'"));
  assert.ok(settings.includes("native&&Capacitor.getPlatform()==='ios'&&activeSection==='files'?<LocalDatabaseImport/>"));
  assert.ok(!settings.includes('const managedScopes='));
  assert.ok(!settings.includes('loc-import-scope'));
  assert.ok(!settings.includes('ManagementImportPanel'));
  assert.ok(shell.includes("const navScopeId=!native&&currentScope.nativeOnly?'loc'"));
  assert.ok(shell.includes("(native||!getScope(id).nativeOnly)"));
  assert.ok(locApp.includes("router.replace('/local/settings/')"));
  assert.ok(locApp.includes("if(scopeMeta?.nativeOnly&&!nativeOnlyReady)"));
});

test('Settings document import is iOS only, and the existing importer uses local SQLite',()=>{
  const settings=readFileSync(new URL('../app/loc/GlobalSettings.jsx',import.meta.url),'utf8');
  const localImport=readFileSync(new URL('../app/loc/LocalDatabaseImport.jsx',import.meta.url),'utf8');
  const panel=readFileSync(new URL('../app/loc/ManagementImportPanel.jsx',import.meta.url),'utf8');
  const dbClient=readFileSync(new URL('../app/loc/db-client.mjs',import.meta.url),'utf8');
  assert.match(settings,/native&&Capacitor\.getPlatform\(\)==='ios'\?\[option\('files'/);
  assert.doesNotMatch(settings,/activeSection==='files'&&!native/);
  assert.doesNotMatch(settings,/loc-import-scope|requestedScope|managedScopes|ManagementImportPanel/);
  assert.match(localImport,/Capacitor\.isNativePlatform\(\)&&Capacitor\.getPlatform\(\)==='ios'/);
  assert.match(localImport,/if\(!native\)return null;/);
  assert.match(localImport,/<ManagementImportPanel scopeId="local"\/>/);
  assert.match(panel,/scopeId==='local'&&Capacitor\.isNativePlatform\(\)&&Capacitor\.getPlatform\(\)==='ios'/);
  assert.match(dbClient,/if\(name==='local'\|\|name\.startsWith\('local_'\)\)return true/);
});

test('LOC public search is global and does not enumerate Scope IDs in its UI',()=>{
  const search=readFileSync(new URL('../app/modular/features/Search.jsx',import.meta.url),'utf8');
  assert.match(search,/const locPublicSearch=scopeId==='loc'&&!managementMode/);
  assert.match(search,/const searchScopes=scopeId==='loc'&&managementMode&&options\.scopeFilter/);
  assert.match(search,/scopeFilter:managementMode\?String\(searchParams\?\.get\('scope'\)\|\|''\):''/);
  assert.match(search,/scopeId==='loc'&&managementMode\?<div className="scope-search-scope-filter">/);
  assert.match(search,/scopeId=\{locPublicSearch\?'':row\.scopeId\}/);
  assert.match(search,/return label&&label!==id\?label:''/);
  assert.match(search,/searchGalaxyRows\(searchScopes,q,/);
  assert.match(search,/queryFn:managementMode\?\(\)=>selectScopeRegistry\(\{scopeKind:'scope'\}\):selectLocSearchScopes/);
});

test('Culture river keeps three collapsed parents, expandable child lanes and touch candidate details',()=>{
  const culture=readFileSync(new URL('../app/modular/features/Culture.jsx',import.meta.url),'utf8');
  const river=readFileSync(new URL('../app/modular/modules/culture-timeline/CultureTimeline.jsx',import.meta.url),'utf8');
  assert.match(culture,/openCultureRoots.*useState/);
  assert.match(culture,/id:'system',label:l\.system/);
  assert.match(culture,/id:'custom',label:l\.custom/);
  assert.match(culture,/id:'media',label:l\.media/);
  assert.match(culture,/onGroupToggle=\{toggleCultureRiverGroup\}/);
  assert.match(culture,/anchorInsight=\{anchorInsight\}/);
  assert.match(culture,/setFocusedAnchorDate\(date\)/);
  assert.match(river,/button\.setAttribute\('aria-expanded'/);
  assert.match(river,/onGroupToggleRef\.current/);
  assert.match(river,/addCustomTime\(/);
  assert.match(river,/scope-candidate-insight/);
});

test('Culture and Statistics Period data read directly when remote ISR is disabled',()=>{
  const route=readFileSync(new URL('../app/api/loc/scopes/[scopeId]/numeric/[kind]/route.js',import.meta.url),'utf8');
  const adapter=readFileSync(new URL('../app/loc/numeric-isr-client.js',import.meta.url),'utf8');
  const culture=readFileSync(new URL('../app/modular/features/Culture.jsx',import.meta.url),'utf8');
  const stats=readFileSync(new URL('../app/modular/features/Statistics.jsx',import.meta.url),'utf8');
  const editor=readFileSync(new URL('../app/modular/features/CultureTimelineEditor.jsx',import.meta.url),'utf8');
  assert.ok(route.includes("from('loc')"));
  assert.ok(route.includes("mode!=='isr'"));
  assert.ok(route.includes('no-store'));
  assert.ok(route.includes("name='read_scope_analytics'"));
  assert.ok(!route.includes('revalidateTag'));
  assert.ok(adapter.includes("mode==='isr'"));
  assert.ok(adapter.includes('credentials:\'omit\''));
  assert.ok(culture.includes('selectScopeCultureData(scopeId)'));
  assert.ok(culture.includes('query.data?.eras?.eras'));
  assert.ok(stats.includes("queryKey:['culture-time-periods',scopeId]"));
  assert.ok(!stats.includes("readNumericIsr(scopeId,'periods')"));
  assert.ok(stats.includes('selectScopeCultureData(scopeId)'));
  assert.ok(stats.includes('sourceChart&&periodNavigationReady'));
  assert.ok(stats.includes('mediaDimension&&periodNavigationReady'));
  assert.ok(editor.includes('revalidateServerMetadata()'));
});

test('Culture upper era selector stays independent; lower river selects only actual trace ranges',()=>{
  const source=readFileSync(new URL('../app/modular/features/Culture.jsx',import.meta.url),'utf8');
  assert.match(source,/aria-label='第一條河道時代選擇'/);
  assert.match(source,/const \[structureWindowKey,setStructureWindowKey\]=useState\(''\)/);
  assert.match(source,/const activeStructureKey=structureWindowKey==='all'/);
  assert.match(source,/setStructureWindowKey\(event\.target\.value\)/);
  assert.match(source,/setStructureWindowKey\(periodKey\(matched\)\)/);
  assert.match(source,/const selectedWorkPeriod=selectedPeriodKey==='all'/,
    'initial first-river fit must not change the lower data query interval');
  const timeline=readFileSync(new URL('../app/modular/modules/culture-timeline/CultureTimeline.jsx',import.meta.url),'utf8');
  assert.match(timeline,/instance\.fit\(\{animation:false\}\)/,
    'unselected first-river window must fit loaded timeline rows');
  assert.match(source,/buildEraRiver\(timelineItems,expandedEraIds\)/);
  assert.match(source,/structureWindowKey==='all'\|\|!structureWindowKey\?'all'/);
  assert.match(source,/onGroupToggle=\{toggleTimeTrace\}/);
  assert.match(source,/windowStart=\{currentStructureStart\}/);
  assert.match(source,/windowEnd=\{currentStructureEnd\}/);
  assert.match(source,/value=\{keywordPeriodKey\}/);
  assert.match(source,/primaryPeriods\.map\(item=><option/);
  assert.doesNotMatch(source,/cultureTimeKind/);
  assert.doesNotMatch(source,/setSelectedPeriodKey\(next\)/);
});

test('Culture river hides zero-count parents, folds singleton children and renders a localized empty state',()=>{
  const code=readFileSync(new URL('../app/modular/features/Culture.jsx',import.meta.url),'utf8');
  assert.match(code,/if\(!activeRoots\.has\(parent\.id\)\|\|parentCount<=0\)continue/);
  assert.match(code,/label:numberedLabel\(label,parentCount\)/);
  assert.match(code,/if\(count<=0\)return/);
  assert.match(code,/label:numberedLabel\(group\.label,count\)/);
  assert.match(code,/const onlyChild=members\.length===1\?members\[0\]:null/);
  assert.match(code,/collapsible:members\.length!==1/);
  assert.match(code,/label=onlyChild\?\.label\|\|parent\.label/);
  assert.match(code,/!cultureRiver\.hasSourceData/);
  assert.match(code,/noDataInPeriod/);
  const river=readFileSync(new URL('../app/modular/modules/culture-timeline/CultureTimeline.jsx',import.meta.url),'utf8');
  assert.match(river,/timelineDataRef=useRef\(null\)/);
  assert.match(river,/timelineGroupsRef=useRef\(null\)/);
  assert.match(river,/groups\.update\(changedGroups\)/);
  assert.match(river,/data\.update\(changedRows\)/);
  assert.match(river,/const preserveTimelineInstance=heightVariant==='double'\|\|mode==='trace'/);
  assert.match(river,/preserveTimelineInstance\?null:rows/);
  assert.match(river,/const visibleItems=useMemo/);
  assert.match(river,/visibleGroups\.has\(String\(item\?\.group_key\|\|''\)\)/);
  assert.match(river,/Number\(item\?\.item_count\)>0/);
  assert.doesNotMatch(river,/Math\.max\(320,152\+compactGroupCount\*48\)/);
  assert.match(river,/if\(obsoleteGroups\.length\)groups\.remove\(obsoleteGroups\)/);
  assert.match(river,/if\(changedGroups\.length\|\|changedRows\.length\|\|obsoleteRows\.length\|\|obsoleteGroups\.length\)/);
  assert.match(river,/\.vis-item\.scope-period-density\.vis-range/);
  assert.match(river,/if\(!cancelled&&!painted\(\)\)setChartError\(true\)/);
  assert.match(river,/timeline\.redraw\(\)/);
  assert.match(river,/timeline\.redraw\(\)/);
});

test('Culture Rune groups expand with bounded on-demand catalog requests',()=>{
  const culture=readFileSync(new URL('../app/modular/features/Culture.jsx',import.meta.url),'utf8');
  const css=readFileSync(new URL('../app/styles/scope-system.css',import.meta.url),'utf8');
  assert.match(culture,/const keywordDetailRequested=Boolean\(keywordDrillSource\)/,
    'opening a Rune group alone must not scan every Galaxy article');
  assert.match(culture,/enabled:styleFilter==='rune66'&&Boolean\(keywordDrillGroup\)/,
    'fetch Rune catalog only after a group is expanded');
  assert.match(culture,/readKeywordTreeCatalog\(scopeId\)/);
  assert.match(culture,/catalog\.groups\.find\(group=>group\.uid===keywordDrillGroup/,'Group catalog is filtered by UID');
  assert.match(culture,/revalidateOnFocus:false/);
  assert.match(culture,/keywordCounts\.set\(key,\(keywordCounts\.get\(key\)\|\|0\)\+\(Number\(item\.item_count\)\|\|0\)\)/,
    'use real daily category counts to show clickable group labels');
  assert.match(culture,/id:'dual:keyword:'\+group\.id/);
  assert.match(culture,/collapsible:true,expanded:keywordDrillGroup===group\.id/);
  assert.match(culture,/id\.startsWith\('dual:keyword:'\)/);
  assert.match(culture,/showKeywordRiver&&keywordDrillGroup\?<section className='scope-culture-rune-list'/);
  assert.match(culture,/keywordGroupCatalogQuery\.data\.map\(rune=>/);
  assert.match(culture,/styleQuery\.data\?\.runeTotals\|\|\[\]/);
  assert.match(css,/\.scope-culture-rune-list ul\{list-style:none/);
});

test('Culture loads management permissions only after authorized homepage editing',()=>{
  const culture=readFileSync(new URL('../app/modular/features/Culture.jsx',import.meta.url),'utf8');
  assert.match(culture,/const canUseScopeEditor=Boolean\(editDock\?\.active&&editDock\.scopeId===scopeId\)/);
  assert.match(culture,/const isTimeEditingView=canUseScopeEditor&&searchParams\?\.get\('edit'\)==='1'/);
  assert.match(culture,/useAccount\(\{enabled:isTimeEditingView\|\|canUseScopeEditor\}\)/);
  assert.match(culture,/const permissionPending=account\.loading\|\|account\.permissionLoading/);
  assert.match(culture,/const editorAuthorized=Boolean\(account\.user&&account\.canManageScopeSync\(scopeId\)\)/);
  assert.match(culture,/editorAvailable&&!permissionPending&&editorAuthorized\?<div/);
  assert.doesNotMatch(culture,/useAccount\(\{enabled:false\}\)/);
});

test('Admin and Scope classification forms share direct one-level DefaultArticleClass editor',()=>{
  const work=readFileSync(new URL('../app/loc/WorkClassificationPage.jsx',import.meta.url),'utf8');
  const personal=readFileSync(new URL('../app/loc/ScopeOthersSources.jsx',import.meta.url),'utf8');
  const editor=readFileSync(new URL('../app/loc/FlatClassificationEditor.jsx',import.meta.url),'utf8');
  assert.match(work,/<FlatClassificationEditor scopeId="loc"\/>/);
  assert.match(personal,/<FlatClassificationEditor scopeId=\{scopeId\}\/>/);
  assert.match(editor,/classification-inline__list/);
  assert.match(editor,/classification-inline__actions/);
  assert.match(editor,/classification-inline__controls/);
  assert.match(editor,/ResizeObserver/);
  assert.match(editor,/gridColumns/);
  assert.match(editor,/next.splice\(target,0,item\)/);
  assert.match(editor,/setDraft\(\[\.\.\.rows,''\]\)/);
  assert.match(editor,/setDraft\(rows.filter/);
  assert.doesNotMatch(editor,/!global\?<button/);
  const css=readFileSync(new URL('../app/styles/settings-select.css',import.meta.url),'utf8');
  assert.match(css,/grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css,/@container classification-inline \(max-width:720px\)/);
  assert.match(css,/@container classification-inline \(max-width:420px\)/);
  assert.match(editor,/type="submit"/);
  assert.match(editor,/\.update\(\{\[scopeTagColumn\(scopeId\)\]:names\}\)/);
  assert.match(editor,/canManageGroupSync\('loc'\)/);
  assert.match(editor,/update_group_default_article_class/);
  assert.match(editor,/canManageScopeSync\(scopeId\)/);
  assert.match(editor,/作品分類/);
  assert.match(editor,/個人分類/);
  assert.doesNotMatch(editor,/classification-page__layout|statistics_source_categories|statistics_scope_others_groups/);
});

test('Scope import separates local preview from explicit Galaxy save',()=>{
  const panel=readFileSync(new URL('../app/loc/ManagementImportPanel.jsx',import.meta.url),'utf8');
  assert.match(panel,/scope-import-primary-row/);
  assert.match(panel,/uiExtra\.importUI\.importLanguage/);
  assert.match(panel,/uiExtra\.importUI\.fileSource/);
  assert.match(panel,/uiExtra\.importUI\.batchImport/);
  assert.match(panel,/className="scope-import-save"/);
  assert.match(panel,/uiExtra\.importUI\.saveSection/);
  assert.match(panel,/uiExtra\.importUI\.saveHint/);
  assert.match(panel,/scope-import-save-button/);
  const chooseAndPreview=panel.split('scope-import-primary-row')[1].split('</div>')[0];
  assert.doesNotMatch(chooseAndPreview,/onClick=\{run\}/);
  assert.match(panel,/scope-import-save[\s\S]*onClick=\{run\}/);
  const css=readFileSync(new URL('../app/styles/features.css',import.meta.url),'utf8');
  assert.match(css,/\.scope-import-save-button/);
  assert.match(panel,/<ImportFormatSettings/);
  assert.doesNotMatch(panel,/function SourceRefresh|function DuplicateDetection|findGalaxyDuplicates/);
});

test('LOC group member editing and system Admin panels are disjoint; media target is fixed',()=>{
  const page=readFileSync(new URL('../app/loc/LocSourceManagement.jsx',import.meta.url),'utf8');
  const admin=readFileSync(new URL('../app/loc/views/AdminHomeView.jsx',import.meta.url),'utf8');
  const target=readFileSync(new URL('../app/loc/ManagementContentTarget.jsx',import.meta.url),'utf8');
  const searchManage=readFileSync(new URL('../app/loc/SearchManagement.jsx',import.meta.url),'utf8');
  const publicSearch=readFileSync(new URL('../app/modular/features/Search.jsx',import.meta.url),'utf8');
  const zh=readFileSync(new URL('../app/i18n/zh_tw.js',import.meta.url),'utf8');
  assert.match(page,/人員作品管理/);
  assert.match(page,/LocGroupMemberList/);
  assert.doesNotMatch(page,/admin-panels\/AdminRegistry|AdminReservedScopeIds/);
  assert.doesNotMatch(admin,/section==='registry'/);
  assert.match(admin,/section==='lists'/);
  assert.match(admin,/section==='network'/);
  assert.match(admin,/<AdminReservedScopeIds\/>/);
  assert.match(admin,/<AdminEmailBlocklist\/>/);
  assert.match(admin,/<DatabaseTarget scopeGroup=\{scopeGroup\}\/>/);
  assert.match(admin,/<IsrDomainTarget\/>/);
  assert.doesNotMatch(admin,/section==='reserved'/);
  assert.doesNotMatch(admin,/section==='blocklist'/);
  assert.doesNotMatch(admin,/section==='database'/);
  assert.doesNotMatch(admin,/section==='isr'/);
  assert.doesNotMatch(admin,/TraceManagementPanel/);
  assert.match(target,/AUTHOR_SCOPE_ID='lo3rwang'/);
  assert.match(target,/scopeData\?\.galaxyMedia/);
  assert.doesNotMatch(target,/目標 Table|<Select|selectScopeRegistry/);
  assert.match(searchManage,/label:'治理原則',shortLabel:'治理原則'/);
  assert.match(publicSearch,/UI_COPY\.features\.trace\.detailsLabel/);
  assert.match(zh,/"detailsLabel": "治理原則"/);
});

test('Admin first tab is People; lists and network consolidate existing secure editors',()=>{
  const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
  const admin=read('app/loc/views/AdminHomeView.jsx');
  const cache=read('app/loc/views/admin-panels/IsrDomainTarget.jsx');
  const dock=read('app/modular/edit-dock.jsx');
  const reserved=read('app/loc/views/admin-panels/AdminReservedScopeIds.jsx');
  const email=read('app/loc/views/admin-panels/AdminEmailBlocklist.jsx');
  const registry=read('app/loc/views/admin-panels/AdminRegistry.jsx');
  const menu=admin.match(/const ADMIN_OPTIONS=Object\.freeze\(\[([\s\S]*?)\]\);/);
  assert.ok(menu,'Admin options are missing');
  assert.deepEqual([...menu[1].matchAll(/value:'([^']+)'/g)].map(x=>x[1]),
    ['lists','network','io','featureHero','themes']);
   assert.match(admin,/section==='io'\?<RuntimeIoSettings\/>/);
   assert.match(read('app/loc/views/admin-panels/RuntimeIoSettings.jsx'),/key:'maxRows'/);
  assert.match(admin,/useManagementSection\(ADMIN_OPTIONS,'lists'/);
  for(const [oldId,newId] of Object.entries({
    database:'network',isr:'network',reserved:'lists',blocklist:'lists'
  }))assert.ok(admin.includes(oldId+":'"+newId+"'"),'legacy section '+oldId+' not mapped');
  assert.match(admin,/section==='lists'\?<\>[\s\S]*?<AdminRegistry\/>[\s\S]*?<AdminReservedScopeIds\/>[\s\S]*?<AdminEmailBlocklist\/>[\s\S]*?<\/\>/);
  assert.match(admin,/section==='network'\?<\>[\s\S]*?<DatabaseTarget scopeGroup=\{scopeGroup\}\/>[\s\S]*?<IsrDomainTarget\/>[\s\S]*?<\/\>/);
  assert.match(cache,/<h2>快取／ISR<\/h2>/);
  assert.match(cache,/CACHE_POLICY/);
  assert.doesNotMatch(cache,/dbAuthRelation|loc_cache_runtime|loc_cache_settings/);
  assert.match(dock,/const dirty=\[\.\.\.registeredEditors\.current\]\.filter/);
  assert.match(dock,/for\(const editor of editors\)/);
  assert.match(reserved,/useEditDockForm/);
  assert.match(email,/useEditDockForm/);
  assert.match(registry,/useEditDockForm/);
  assert.match(reserved,/p_section:'scopeid'/);
  assert.match(email,/p_section:'email'/);
  assert.doesNotMatch(admin,/updateRows|deleteRows|insertRows/);
});

test('Culture second river waits for its first source snapshot and avoids lazy density remounts',()=>{
  const culture=readFileSync(new URL('../app/modular/features/Culture.jsx',import.meta.url),'utf8');
  const river=readFileSync(new URL('../app/modular/modules/culture-timeline/CultureTimeline.jsx',import.meta.url),'utf8');
  assert.match(culture,/stagedSourceRiver\?sourceRootQuery\.data:sourceSnapshotQuery\.data/);
  assert.match(culture,/openCultureRoots\.length>0/);
  assert.ok(culture.includes('selectScopeDailyCounts(scopeData,{'));
  assert.ok(culture.includes('selectCultureRiverChildren(sourceRootQuery.data.numericRows,publishedTaxonomy,expandedSourceRoots)'));
  assert.ok(!culture.includes('readNumericIsr('));
  assert.doesNotMatch(culture,/\(!sourceSnapshotQuery\.data\|\|riverRangeLoading\|\|cultureRiver\.hasSourceData\)/);
  assert.match(river,/preserveTimelineInstance\?null:hiddenDates/);
  assert.match(river,/timeline\.setOptions\(\{hiddenDates:/);
  assert.match(river,/appliedHiddenDatesRef\.current=hiddenDates/);
});


test('Scope editor uses time/spatial anchor labels and preserves LOC group labels',()=>{
  const shell=readFileSync(new URL('../app/AppShell.jsx',import.meta.url),'utf8');
  const dock=readFileSync(new URL('../app/modular/edit-dock.jsx',import.meta.url),'utf8');
  assert.match(shell, /\{id:'members',icon:'culture',label:translateUiField\(activeLocale,'人員作品管理'\)/);
  assert.match(shell, /\{id:'time',icon:'culture',label:translateUiField\(activeLocale,'時間定錨'\)/);
  assert.match(shell,/\{id:'manage',icon:'trace',label:navScopeId==='local'\?'管理':translateUiField\(activeLocale,'空間定錨'\)/);
  assert.match(shell,/translateUiField\(activeLocale,'關鍵詞'\)/);
  assert.match(shell,/translateUiField\(activeLocale,'儲存'\)/);
  assert.doesNotMatch(shell,/translateUiField\(activeLocale,'設立定錨'\)/);
  assert.doesNotMatch(shell,/translateUiField\(activeLocale,'痕跡管理'\)/);
  assert.match(dock,/目前修改已儲存。/);
  assert.doesNotMatch(dock,/已暫存/);
  assert.doesNotMatch(dock,/已分段儲存/);
});

test('Culture Time management uses one editor with anchor, event and trace types rather than three redundant tabs',()=>{
  const culture=readFileSync(new URL('../app/modular/features/Culture.jsx',import.meta.url),'utf8');
  const editor=readFileSync(new URL('../app/modular/features/CultureTimelineEditor.jsx',import.meta.url),'utf8');
  assert.doesNotMatch(culture,/TIME_EDITOR_SECTIONS|timeEditorSection|time-editor-sections|<ManagementSectionNav/);
  assert.match(culture,/id='time-editor-panel' role='region'/);
  assert.match(culture,/items=\{timelineItems\}/);
  assert.match(culture,/onSelect=\{item=>beginTimelineRecordEdit\(item\)\}/);
  assert.match(culture,/onTimeClick=\{date=>beginTimelineCreation\('anchor',date\)\}/);
  assert.match(culture,/defaultRecordType='anchor'/);
  assert.match(editor,/const TYPES=\['anchor','period','era'\]/);
  assert.match(editor,/const normalizeType=value=>\(\{event:'period'\}\[value\]\|\|value\)/);
  assert.match(editor,/const TYPE_TABS=\[\.\.\.TYPES\]\.reverse\(\)/);
   assert.match(editor,/\{TYPE_TABS\.map\(type=><button/);
   assert.match(editor,/aria-pressed=\{browseType===type\}/);
   assert.match(editor,/onChange=\{option=>option\?selectRow\(option\.value\):beginNew\(\)\}/);
  assert.match(editor,/payload\.anchor_ids=draft\.type==='era'/);
  assert.match(editor,/updateRows\(timeTable,payload/);
  assert.match(editor,/insertRows\(timeTable,/);
  assert.match(editor,/deleteRows\(timeTable,/);
});


test('mobile UI keeps safe-area navigation, accessible rune dialog and low-churn scrolling',()=>{
  const nav=readFileSync(new URL('../app/modular/ScrollableScopeNav.jsx',import.meta.url),'utf8');
  const dock=readFileSync(new URL('../app/styles/bottom-navigation.css',import.meta.url),'utf8');
  const nativeNav=readFileSync(new URL('../app/styles/nav.css',import.meta.url),'utf8');
  const runes=readFileSync(new URL('../app/lrunes/Rune3DPreview.jsx',import.meta.url),'utf8');
  const runeCss=readFileSync(new URL('../app/lrunes/effekseer/effekseer-stage.css',import.meta.url),'utf8');
  const shell=readFileSync(new URL('../app/AppShell.jsx',import.meta.url),'utf8');
  assert.match(nav,/setPosition\(previous=>previous\.overflow===next\.overflow/);
  assert.match(nav,/behavior:reduce\?'auto':'smooth'/);
  assert.match(dock,/\.scope-feature-dock :is\(a,button\)>span/);
  assert.match(dock,/body:has\(\.scope-feature-dock \.scope-edit-dock-notice\)/);
  assert.match(dock,/env\(safe-area-inset-left,0px\)/);
  assert.match(nativeNav,/\.scope-global\[data-native="ios"\][\s\S]*?min-height:44px;/);
  assert.match(runes,/document\.addEventListener\('keydown',handleKey\)/);
  assert.match(runes,/document\.body\.style\.overflow='hidden'/);
  assert.match(runes,/previousFocus\.isConnected\)previousFocus\.focus\(\)/);
  assert.match(runeCss,/max-height:min\(85dvh/);
  assert.match(shell,/document\.documentElement\.lang=activeLocale/);
});

test('one device default time unit changes presentation, never article URLs or SQL',async()=>{
  const {timeUnitBucket,normalizeDefaultTimeUnit}=await import('../app/loc/default-time-unit.mjs');
  assert.equal(normalizeDefaultTimeUnit('unexpected'),'auto');
  assert.deepEqual(timeUnitBucket('2026-11-01','week'),{
    key:'2026-10-26',startDate:'2026-10-26',endDate:'2026-11-01',endExclusive:'2026-11-02'
  });
  assert.deepEqual(timeUnitBucket('2026-11-02','week'),{
    key:'2026-11-02',startDate:'2026-11-02',endDate:'2026-11-08',endExclusive:'2026-11-09'
  });
  assert.equal(timeUnitBucket('2024-02-15','month').endDate,'2024-02-29');
  assert.equal(timeUnitBucket('2026-11-02','year').endDate,'2026-12-31');
  assert.equal(timeUnitBucket('2026-02-30','week'),null);
  const file=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
  const settings=file('app/loc/GlobalSettings.jsx');
  const culture=file('app/modular/modules/culture-timeline/CultureTimeline.jsx');
  const statistics=file('app/modular/features/Statistics.jsx');
  const trace=file('app/modular/features/trace/TracePlaceResults.jsx');
  const search=file('app/modular/features/Search.jsx');
  assert.match(settings,/saveDefaultTimeUnit\(event\.target\.value\)/);
  assert.match(culture,/timeAxis:\{scale:defaultTimeUnit,step:1\}/);
  assert.match(statistics,/defaultTimeUnit==='auto'/);
  assert.match(trace,/timeUnitBucket\(row\.day,viewUnit\)/);
  assert.match(search,/timeUnitBucket\(localTodayKey\(\),defaultTimeUnit/);
  assert.match(search,/onClick=\{applyDefaultTimeWindow\}/);
  assert.match(trace,/start_date:startDate,end_date:endExclusive/);
  // Zero new API endpoints, migrations, automatic search filters or URL changes.
  assert.doesNotMatch(settings,/dbAuthRelation\(.*DEFAULT_TIME_UNIT_KEY/);
});


// 2026-11-05 targeted regression: no duplicate hot-path Save or post-save reads.
test('Edit Dock provides one explicit Save and never saves an unchanged editor',()=>{
  const dock=read('app/modular/edit-dock.jsx');
  const shell=read('app/AppShell.jsx');
  assert.match(dock,/const editors=dirty;/);
  assert.match(dock,/if\(!editors\.length\)\{\s*setNotice\('目前沒有待儲存的變更。'\)/);
  assert.doesNotMatch(dock,/saveAndSwitch|stayInEditMode|已暫存|儲存並切換/);
  assert.match(shell,/editDock\.save\(\)/);
  assert.doesNotMatch(shell,/editDock\.save\(\{stayInEditMode/);
});

test('Homepage real Save avoids repeated SELECT and a forced page navigation',()=>{
  const drafts=read('app/loc/ScopeBlockDraftList.jsx');
  const blocks=read('app/loc/ScopeEditableBlocks.jsx');
  assert.match(drafts,/async function publishSavedBlocks\(rows\)/);
  assert.match(drafts,/mutate\(appBootstrapKey\(scopeId,pageName\)/);
  assert.match(drafts,/\{revalidate:false\}/);
  assert.doesNotMatch(drafts,/refreshBlockQueries|await mutate\(bootstrapKey\)|await mutate\(displayKey\)/);
  assert.match(blocks,/if\(editDock\?\.active&&editDock\.scopeId===scopeId\)\{[\s\S]*?return;/);
});

test('Inline block, classification, route and time editors reuse fixed Dock Save',()=>{
  const single=read('app/loc/ScopeBlockEditorSession.jsx');
  const classes=read('app/loc/FlatClassificationEditor.jsx');
  const trace=read('app/loc/TraceRouteManager.jsx');
  const culture=read('app/modular/features/CultureTimelineEditor.jsx');
  assert.match(single,/useEditDockForm\(\{save,isDirty:/);
  assert.match(single,/\.\.\.\(inDock\?\[\]:\[\{key:'save'/);
  assert.match(classes,/!inDock\?<button className="loc-button primary"/);
  assert.match(trace,/!inDock\?<button className="loc-button primary"/);
  assert.match(culture,/onSubmit=\{event=>event\.preventDefault\(\)\}/);
});

test('Culture refreshes active source-window keys, not retired v2/v6 keys',()=>{
  const culture=read('app/modular/features/Culture.jsx');
  assert.match(culture,/resourceCache\.invalidate\(\{queryKey:\['culture-period-roots'\]\}\)/);
  assert.match(culture,/resourceCache\.invalidate\(\{queryKey:\['culture-period-source-snapshot'\]\}\)/);
});

test('Search shows Galaxy date and updates same-page URL without a route remount',()=>{
  const search=read('app/modular/features/Search.jsx');
  const providers=read('app/loc/galaxy-query.js');
  assert.match(search,/date=\{row\.date\}/);
  assert.match(search,/window\.history\.pushState\(null,'',url\)/);
  assert.match(providers,/\.\.\.\(!localArticle\(current\)\?\['date'\]:\[\]\)/);
});

test('LOC permission snapshot does one Kysely query rather than two per request',()=>{
  const auth=readFileSync(new URL('../app/loc/providers/loc-authorization.mjs',import.meta.url),'utf8');
  assert.match(auth,/crossJoin\('silver\.loc as l'\)/);
  assert.doesNotMatch(auth,/const config=await db\.selectFrom\('silver\.loc'\)/);
});


test('Verified Clerk OAuth expiry bounds lazy LOC authorization cache across requests',async()=>{
  // Execute the actual pure authorization module with a fake Kysely SELECT.
  // No Supabase connection, RLS or user credential is involved.
  const source=read('app/loc/providers/loc-authorization.mjs')
    .replace(/^export /gm,'');
  const {bindLocAuthorization,locPermissions}=vm.runInNewContext(
    source+'\n;({bindLocAuthorization,locPermissions})',{Date,Promise});
  let selects=0;
  const db=()=>({
    fn:()=>'(lower email)',
    selectFrom(){selects+=1;return{
      crossJoin(){return this;},select(){return this;},where(){return this;},
      async execute(){return[{
        id:'lo3rwang',email:'editor@example.org',manage_role:'scope',active:true,
        galaxy_table:'galaxy',anchor_table:'anchor',birthday:null,
        blacklist:{email:[]}
      }];}
    }}
  });
  const claims={provider:'clerk',sub:'user_Abc123',email:'editor@example.org',
    sid:'session-1',exp:Math.floor(Date.now()/1000)+120};
  const first=db(),second=db();
  bindLocAuthorization(first,{role:'authenticated',claims});
  bindLocAuthorization(second,{role:'authenticated',claims});
  const [one,two]=await Promise.all([locPermissions(first),locPermissions(second)]);
  assert.equal(selects,1,'same unexpired OAuth session reuses one SQL permission check');
  assert.equal(one.rows[0].id,'lo3rwang');
  assert.equal(two.rows[0].id,'lo3rwang');
  const another=db();
  bindLocAuthorization(another,{role:'authenticated',claims:{...claims,sid:'session-2'}});
  await locPermissions(another);
  assert.equal(selects,2,'different Clerk session never reuses prior authorization');
  const expired=db();
  bindLocAuthorization(expired,{role:'authenticated',
    claims:{...claims,exp:Math.floor(Date.now()/1000)-1}});
  await locPermissions(expired);
  assert.equal(selects,3,'expired OAuth credentials cannot reuse the cache');
});
