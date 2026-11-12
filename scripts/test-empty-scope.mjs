import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import vm from 'node:vm';
import {sourceTaxonomyFromArrays} from '../app/loc/source-classification.mjs';
import {administrativeSourceTrend} from '../app/loc/statistics-admin-source.mjs';
import {summarizeCultureRiverRoots,selectCultureRiverChildren} from '../app/loc/culture-river-roots.mjs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

// Empty Scopes remain valid when the remote ISR API is retired.
test('disabled ISR routes never scan empty Scope tables or call public RPC',()=>{
  const numeric=read('app/api/loc/scopes/[scopeId]/numeric/[kind]/route.js');
  const invalidation=read('app/api/loc/revalidate/route.js');
  assert.match(numeric,/status:410/);
  assert.match(invalidation,/status:410/);
  assert.doesNotMatch(numeric,/read_scope_statistics|read_scope_place_statistics|unstable_cache/);
});

test('No work categories or personal categories preserves raw sources',()=>{
  const {categories,aliases,groups,groupAliases}=sourceTaxonomyFromArrays([],[]);
  assert.deepEqual({categories,aliases,groups,groupAliases},{
    categories:[],aliases:[],groups:[],groupAliases:[]
  });
  // Work classification and personal classification may be empty separately.
  assert.deepEqual(sourceTaxonomyFromArrays(['facebook'],[]).groups,[]);
  assert.deepEqual(sourceTaxonomyFromArrays([],['suno']).categories,[]);
  const rows=[
    {kind:'source',category:'unknown-source',day:'2026-10-25',item_count:3},
    {kind:'total',category:'文字作品',day:'2026-10-25',item_count:3}
  ];
  const roots=summarizeCultureRiverRoots(rows,{categories,aliases});
  assert.deepEqual(roots.rootBuckets,[{category:'custom',start_date:'2026-10-25',item_count:3}]);
  assert.equal(roots.groups[0].site,'unknown-source');
  assert.equal(selectCultureRiverChildren(rows,{categories,aliases},['custom']).length,1);
  const stats=administrativeSourceTrend(rows,{categories,aliases},{
    startDate:'2026-10-25',endDate:'2026-10-25',unit:'day'
  });
  assert.equal(stats.total,3);
  assert.equal(stats.distribution[0]?.name,'未分類');
  assert.equal(stats.distribution[0]?.value,3);
});

test('No spatial anchors, no saved route maps and no keyword groups are valid',()=>{
  const traceData=read('app/modular/features/trace/trace-data.js');
  const trace=read('app/modular/features/Trace.jsx');
  const culture=read('app/loc/culture-query.js');
  const classification=read('app/loc/source-classification.mjs');
  assert.match(traceData,/anchors:rows\.filter\(row=>row\.trace_type==='anchor'\)/);
  assert.match(traceData,/maps:rows\.filter\(row=>row\.trace_type==='map'\)/);
  assert.match(trace,/if\(!routeListOpen\|\|traceIndex\.data===undefined\)return \{anchors:\[\],maps:\[\]\}/);
  assert.match(culture,/const anchors=new Map\(all\.filter\(row=>row\.entry_type==='anchor'\)/);
  assert.match(classification,/sourceTaxonomyFromArrays\(systemNames=\[\],personalNames=\[\]\)/);
});

test('empty classifications and source counts are valid presentation inputs',()=>{
  const taxonomy=sourceTaxonomyFromArrays([],[]);
  assert.deepEqual(taxonomy,{categories:[],aliases:[],groups:[],groupAliases:[]});
  const result=administrativeSourceTrend([],taxonomy,{
    startDate:'2026-10-20',endDate:'2026-10-25',unit:'day'
  });
  assert.equal(result.total,0);
  assert.equal(result.rows.length,6);
  assert.equal(result.series.length,0);
  assert.equal(result.distribution.length,0);
  assert.deepEqual(summarizeCultureRiverRoots([],taxonomy),{rootBuckets:[],groups:[]});
});

test('empty Time and optional Event or Keywords do not block page usage',()=>{
  const culture=read('app/modular/features/Culture.jsx');
  const statistics=read('app/modular/features/Statistics.jsx');
  const trace=read('app/modular/features/Trace.jsx');
  const keyword=read('app/loc/keyword-analysis.js');
  assert.match(culture,/if\(primaryPeriods.length\)return periodRange/);
  assert.match(culture,/const hasTimelineSurface=.*Boolean\(query\.data\)/);
  assert.match(culture,/optionalTimeRangeUnfilled/);
  assert.match(culture,/尚未選擇時間範圍/);
  assert.match(statistics,/periodQuery\.data!==undefined/);
  assert.match(statistics,/scopeId!=='loc'&&Boolean\(targetScopes\[0\]\)/);
  assert.match(statistics,/scopeId==='loc'\|\|periodQuery\.data!==undefined/);
  assert.match(statistics,/periods\.length\?'最新時期':'未設定時期（預設時間）'/);
  assert.match(trace,/\[timeWindow,setTimeWindow\]=useState\('year'\)/);
  assert.match(trace,/traceWindow\(timeWindow,new Date\(\)/);
  assert.match(keyword,/if\(!currentId\)return ''/);
});
