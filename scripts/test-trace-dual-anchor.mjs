import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {traceArticlePlaces} from '../app/modular/features/trace/trace-article-places.mjs';
const anchor=(uid,title)=>({uid,title,trace_type:'anchor',source_scope:'lo3rwang'});
const source=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
test('Banqiao station uses only verified old and high-speed names',()=>{
  assert.deepEqual(traceArticlePlaces(anchor('MD3U6B0A','板橋車站')),[ '板橋車站',
    '板橋車站 (臺灣)','台灣高鐵板橋站 THSR Banqiao Station','高鐵板橋站']);
});
test('saved route joins anchored places but deduplicates title and retains scope boundaries',()=>{
  const a=anchor('AAA00001','板橋車站'),b=anchor('BBB00002','福隆海水浴場');
  const map={uid:'MAP00001',trace_type:'map',source_scope:'lo3rwang',anchor_list:[a.uid,b.uid]};
  const places=traceArticlePlaces(map,[a,b,{...anchor('AAA00001','另一範圍'),source_scope:'lrunes'}]);
  assert.equal(places.length,5);
  assert.ok(places.includes('福隆海水浴場'));
  assert.equal(places.filter(x=>x==='板橋車站').length,1);
});
test('never do brand-only or distance-only fuzzy expansion',()=>{
  assert.deepEqual(traceArticlePlaces(anchor('AAA00001','拉亞漢堡行天宮店')),['拉亞漢堡行天宮店']);
  assert.deepEqual(traceArticlePlaces({uid:'MAP00001',trace_type:'map',source_scope:'lo3rwang',anchor_list:['unknown']},[]),[]);
});
test('trace data and on-demand reports work without ISR or article preloading',()=>{
  const route=source('app/api/loc/scopes/[scopeId]/numeric/[kind]/route.js');
  const client=source('app/loc/numeric-isr-client.js');
  const trace=source('app/modular/features/Trace.jsx');
  const report=source('app/modular/features/trace/TracePlaceResults.jsx');
  assert.match(route,/status:410/);
  assert.match(client,/return false/);
  assert.doesNotMatch(trace,/readNumericIsr\(scopeId,'traces'\)/);
  assert.match(trace,/maps\.map\(map/);
  assert.match(trace,/readCurrentTraceAnchors\(periodScopeId,currentMap\.anchor_list\)/);
  assert.match(report,/enabled:enabled&&tab==='articles'/);
  assert.match(report,/enabled:useSummary/);
  assert.match(report,/readPlaceSummary\(targetScope/);
  assert.match(report,/traceArticleFilters\(sourcePlaces,/);
  assert.match(report,/const PAGE_SIZE=100/);
  assert.doesNotMatch(route,/\\.select\\('uid,content'\\)/);
});
