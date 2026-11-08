import assert from 'node:assert/strict';
import {test} from 'node:test';
import {comparisonMetricGroups,selectedComparisonMetricGroup,firstAvailableGroupMetric}
  from '../app/modular/modules/statistics/statistics-compare-options.mjs';

const make=(id,name)=>({id,name,kind:'source'});
test('two selectors isolate dimension families, including the all tab',()=>{
  const families={
    source:[{name:'作品分類',item:make('source-rollup','作品分類'),items:[make('facebook','Facebook')]}],
    media:[{name:'音樂',item:make('media-music','音樂'),items:[make('suno','Suno')]}],
    keyword:[{name:'關鍵詞群組',item:make('keyword-group','群組'),items:[make('keyword-item','項目')]}]
  };
  assert.deepEqual(comparisonMetricGroups('source',families).map(g=>g.key),['source:0']);
  assert.deepEqual(comparisonMetricGroups('media',families).map(g=>g.key),['media:0']);
  assert.deepEqual(comparisonMetricGroups('keyword',families).map(g=>g.key),['keyword:0']);
  const all=comparisonMetricGroups('all',families);
  assert.deepEqual(all.map(g=>g.name),['作品分類','音樂','關鍵詞群組']);
  assert.equal(selectedComparisonMetricGroup(all,'keyword-item')?.key,'keyword:0');
  assert.equal(firstAvailableGroupMetric(all[0],new Set(['source-rollup'])),'facebook');
  assert.equal(firstAvailableGroupMetric(all[0],new Set(['source-rollup','facebook'])),'');
  assert.equal(firstAvailableGroupMetric(all[2],new Set()),'keyword-group');
});
test('empty or absent categories cannot generate phantom metrics',()=>{
  assert.deepEqual(comparisonMetricGroups('keyword',{keyword:[]}),[]);
  assert.equal(selectedComparisonMetricGroup([],''),null);
  assert.equal(firstAvailableGroupMetric(null,new Set()),'');
  assert.deepEqual(comparisonMetricGroups('all',{source:[{name:'empty',items:[]}]}),[]);
});

test('statistics charts delegate resizing to Recharts except Treemap compatibility',async()=>{
  const {readFile}=await import('node:fs/promises');
  const source=await readFile(new URL('../app/modular/modules/statistics/StatisticsMultiChart.jsx',import.meta.url),'utf8');
  assert.match(source,/cloneElement\(chart,\{responsive:true,style:/);
  assert.match(source,/actual==='treemap'/);
  assert.match(source,/<ResponsiveContainer width="100%" height="100%">\{chart\}<\/ResponsiveContainer>/);
});

test('statistics route provides the same Dashboard and Scope switcher for every Scope',async()=>{
  const {readFile}=await import('node:fs/promises');
  const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
  const [statistics,group,nav,locApp]=await Promise.all([
    read('app/modular/features/Statistics.jsx'),
    read('app/loc/ScopeGroupOverview.jsx'),
    read('app/modular/modules/statistics/StatisticsScopeNavigation.jsx'),
    read('app/loc/LocApp.jsx')
  ]);
  assert.match(statistics,/<StatisticsScopeNavigation scopeId=\{scopeId\}/,
    'Single Scope and LOC statistics must both expose navigation');
  assert.match(statistics,/return <ScopeStatisticsPanel scopeId=\{scopeId\}/,
    'Every non-group Scope retains the shared statistics dashboard');
  assert.match(group,/if\(featureId==='statics'\)/,
    'Scope Group statistics must use a dashboard rather than the old directory');
  assert.match(group,/statistics-dashboard__group-grid/);
  assert.match(locApp,/groupOverviewView\?<FeaturePage featureId=\{forcedView\}>/,
    'Direct Group routes must still render ScopeGroupOverview');
  assert.match(nav,/SCOPE_ROUTE_INDEX/);
  assert.match(nav,/navigationHref\(row.id,'statics',native\)/);
  assert.doesNotMatch(nav,/selectScopeRegistry|selectScopeGroupChildren|fetch\(|useAsyncResource/,
    'Scope switching must not fetch unrelated Scope data');
});

test('group Dashboard does not aggregate child Scope content or introduce new data queries',async()=>{
  const {readFile}=await import('node:fs/promises');
  const group=await readFile(new URL('../app/loc/ScopeGroupOverview.jsx',import.meta.url),'utf8');
  const dashboard=group.split("if(featureId==='statics'){")[1]?.split("return <section className=\"scope-card scope-group-overview\"")[0]||'';
  assert.match(dashboard,/query\.isPending/);
  assert.match(dashboard,/scopes\.filter\(row=>row\.scope_kind==='scope'\)/);
  assert.doesNotMatch(dashboard,/selectScopeOverview|selectLocStatistics|selectRows\(|Promise\.all\(/);
  const nav=await readFile(new URL('../app/modular/modules/statistics/StatisticsScopeNavigation.jsx',import.meta.url),'utf8');
  assert.match(nav,/row\.active!==false/);
  assert.match(nav,/row\.config\?\.statistics_able!==false/);
});
