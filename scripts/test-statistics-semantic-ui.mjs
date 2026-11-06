import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {semanticStatisticChartTypes,availableStatisticChartTypes,preferredStatisticChartType} from '../app/modular/modules/statistics/statistics-time-zoom.mjs';

const ids=rows=>rows.map(([id])=>id);
const two=[{name:'north',value:12},{name:'south',value:7}];

test('a category-only dataset cannot be rendered as an invented time-series line',()=>{
  assert.equal(ids(availableStatisticChartTypes({distribution:two})).includes('line'),false);
});
test('keyword and multimedia hits do not offer exclusive-composition pies',()=>{
  assert.deepEqual(ids(semanticStatisticChartTypes({purpose:'keyword',distribution:two})),['bar']);
  assert.deepEqual(ids(semanticStatisticChartTypes({purpose:'media',distribution:two})),['bar']);
});
test('only exclusive sources may use composition pies',()=>{
  assert.deepEqual(ids(semanticStatisticChartTypes({purpose:'source',distribution:two})),['bar','pie','treemap']);
  assert.deepEqual(ids(semanticStatisticChartTypes({purpose:'place',distribution:two})),['bar']);
});
test('dense categorical pies are omitted in favor of readable rankings',()=>{
  const distribution=Array.from({length:8},(_,i)=>({name:'source-'+i,value:i+1}));
  assert.equal(ids(semanticStatisticChartTypes({purpose:'source',distribution})).includes('pie'),false);
});
test('total time series enables native trend and average-composed options',()=>{
  const rows=[{period:'01',total:1},{period:'02',total:2},{period:'03',total:3}];
  assert.deepEqual(ids(semanticStatisticChartTypes({purpose:'total',rows,totalKey:'total'})),['line','composed','area','bar']);
});
test('relationship graph retains the editor and phone/Theme controls',()=>{
  const panel=readFileSync(new URL('../app/loc/KeywordLibraryPanel.jsx',import.meta.url),'utf8');
  const graph=readFileSync(new URL('../app/loc/KeywordNetworkEditor.jsx',import.meta.url),'utf8');
  const css=readFileSync(new URL('../app/styles/scope-system.css',import.meta.url),'utf8');
  const graphPanel=panel.slice(panel.indexOf("workspace==='network'"));
  assert.match(graphPanel,/draftEditor/);
  assert.doesNotMatch(graphPanel,/setWorkspace\('manual'\)/);
  assert.match(graph,/network\.setData\(themeData/);
  assert.match(graph,/MutationObserver/);
  assert.match(graph,/manipulation:false/);
  assert.match(graph,/onNewGroup/);
  assert.match(css,/scope-keyword-network-controls[^{]*\{[^}]*min-height:44px/);
});

test('each statistic chooses a chart for its meaning, not the picker list order',()=>{
  const distribution=[['line','timeline'],['bar','ranking'],['pie','composition']];
  assert.equal(preferredStatisticChartType({purpose:'total',available:distribution}), 'line');
  assert.equal(preferredStatisticChartType({purpose:'source',available:distribution}), 'line');
  assert.equal(preferredStatisticChartType({purpose:'place',available:distribution}), 'bar');
  assert.equal(preferredStatisticChartType({purpose:'keyword',available:distribution}), 'bar');
  assert.equal(preferredStatisticChartType({purpose:'media',available:distribution}), 'bar');
  assert.equal(preferredStatisticChartType({purpose:'comparison',available:distribution}), 'line');
  assert.equal(preferredStatisticChartType({purpose:'media',available:distribution,requested:'line'}), 'line');
  assert.equal(preferredStatisticChartType({purpose:'media',available:[['line','trend']]}), 'line');
});

test('active keyword and location ranking use categorical horizontal bars',()=>{
  const keyword=readFileSync(new URL('../app/modular/modules/statistics/StatisticsMultiChart.jsx',import.meta.url),'utf8');
  const place=readFileSync(new URL('../app/modular/features/trace/PlaceStatisticsPanel.jsx',import.meta.url),'utf8');
  assert.match(keyword,/barLayout="vertical"/);
  assert.match(place,/barLayout=\{activeChart==='bar'\?'vertical':'horizontal'\}/);
  assert.match(keyword,/actual==='bar'&&barLayout==='vertical'&&categories\.length/);
});

test('overlapping counts are never portrayed as additive stacked areas',()=>{
  const rows=[{period:'01',a:4,b:3},{period:'02',a:2,b:5},{period:'03',a:6,b:4}];
  const series=[{key:'a',label:'A'},{key:'b',label:'B'}];
  for(const purpose of ['place','keyword','media','comparison']){
    const types=ids(semanticStatisticChartTypes({purpose,rows,series,distribution:two}));
    assert.equal(types.includes('stacked'),false,purpose);
    assert.equal(types.includes('pie'),false,purpose);
  }
  assert.equal(ids(semanticStatisticChartTypes({purpose:'source',rows,series,distribution:two})).includes('stacked'),true);
});

test('media and place statistic tabs use existing Keyword Category/Class analysis',()=>{
  const page=readFileSync(new URL('../app/modular/features/Statistics.jsx',import.meta.url),'utf8');
  assert.match(page,/STAT_TYPES=\['total','source','keywords','media','place'\]/);
  assert.match(page,/keywordDimension=\['keywords','media','place'\]\.includes\(rankingType\)/);
  assert.match(page,/const scopedKeywordClasses=categoryNames\.length/);
  assert.match(page,/String\(item\.categoryName\|\|item\.name\|\|''\)/);
  assert.match(page,/selectKeywordAnalysisSummary\(/);
  assert.doesNotMatch(page,/<PlaceStatisticsPanel/);
  assert.doesNotMatch(page,/import\('\.\/trace\/PlaceStatisticsPanel'\)/);
  assert.doesNotMatch(page,/<MediaFacetStatistics/);
});
