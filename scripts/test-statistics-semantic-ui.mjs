import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {semanticStatisticChartTypes,availableStatisticChartTypes} from '../app/modular/modules/statistics/statistics-time-zoom.mjs';

const ids=rows=>rows.map(([id])=>id);
const two=[{name:'north',value:12},{name:'south',value:7}];

test('a category-only dataset cannot be rendered as an invented time-series line',()=>{
  assert.equal(ids(availableStatisticChartTypes({distribution:two})).includes('line'),false);
});
test('keyword and multimedia hits do not offer exclusive-composition pies',()=>{
  assert.deepEqual(ids(semanticStatisticChartTypes({purpose:'keyword',distribution:two})),['bar']);
  assert.deepEqual(ids(semanticStatisticChartTypes({purpose:'media',distribution:two})),['bar']);
});
test('source and location categories retain meaningful distribution charts',()=>{
  assert.deepEqual(ids(semanticStatisticChartTypes({purpose:'source',distribution:two})),['bar','pie','treemap']);
  assert.deepEqual(ids(semanticStatisticChartTypes({purpose:'place',distribution:two})),['bar','pie']);
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
