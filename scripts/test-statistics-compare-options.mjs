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
