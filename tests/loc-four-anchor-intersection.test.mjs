import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {publishedSourceTaxonomy} from '../app/modular/published-source-taxonomy.js';
import {
  INTERSECTION_FAMILIES,timeIntersectionMetrics,spaceIntersectionMetrics,
  sourceIntersectionMetrics,fourDimensionDailyCounts
} from '../app/loc/statistics/four-anchor-intersection.mjs';
import {comparisonMetricGroups} from '../app/modular/modules/statistics/statistics-compare-options.mjs';

const anchor=(type,uid,title,attr)=>({type,uid,title,attr});
const dayCount=(counts,metric,day)=>counts.get(metric.id)?.get(day)||0;
const labels=(rows)=>rows.map(row=>row.name);

const timeline=[
  anchor('date','DATE0001','Jan 1',{date:'2026-01-01'}),
  anchor('date','DATE0002','Jan 31',{date:'2026-01-31'}),
  anchor('date','DATE0003','Mar 1',{date:'2026-03-01'}),
  anchor('date','DATE0004','Mar 31',{date:'2026-03-31'}),
  anchor('period','PERI0001','January',{uid:['DATE0001','DATE0002']}),
  anchor('period','PERI0002','March',{uid:['DATE0003','DATE0004']}),
  anchor('period','PERI0003','Unassigned',{date:['2026-04-01','2026-04-30']}),
  anchor('era','ERA00001','Year Part',{period:['PERI0001','PERI0002'],
    date:['2026-01-01','2026-03-31']})
];
const places=[
  anchor('point','POIN0001','One',{latitude:25,longitude:121}),
  anchor('point','POIN0002','Two',{latitude:25,longitude:121}),
  anchor('path','PATH0001','Road One',{point:['POIN0001','POIN0001','POIN0002']}),
  anchor('path','PATH0002','Other Road',{point:['POIN0002']}),
  anchor('trace','TRAC0001','My Trace',{
    path:['PATH0001'],point:['POIN0001','POIN0001']
  })
];

test('intersection dimensions permit only the two requested non-leaf levels',()=>{
  assert.deepEqual(INTERSECTION_FAMILIES.map(x=>[x.value,x.types]),[
    ['time',['era','period']],['space',['trace','path']],
    ['keyword',['keyword_group','keyword_item']],
    ['source',['source_tree']]
  ]);
  const code=readFileSync(new URL('../app/modular/modules/statistics/ScopeSelfIntersection.jsx',import.meta.url),'utf8');
  assert.match(code,/timeAnchors=useAsyncResource/);
  assert.match(code,/enabled:valid&&shownKinds.includes\('time'\)/);
  assert.match(code,/enabled:valid&&shownKinds.includes\('space'\)/);
  assert.match(code,/family:'time'/);
  assert.match(code,/family:'space'/);
  assert.match(code,/p_view:'trace_territory'/);
  assert.doesNotMatch(code,/source_rollup|others_subgroup|keyword_all|keyword_group_items/);
  assert.match(code,/SourceTreePicker/);
  assert.match(code,/selectableTypes=\{\['galaxy','domain'\]\}/);
  assert.doesNotMatch(code,/kind:'from'|kind:'point'|kind:'date'/);
});

test('Era combines actual Period ranges without filling the gaps between them',()=>{
  const metrics=timeIntersectionMetrics(timeline);
  assert.deepEqual(metrics.map(row=>row.kind),['era','period','period','period']);
  const era=metrics.find(x=>x.kind==='era');
  assert.deepEqual(era.windows,[
    {startDate:'2026-01-01',endDate:'2026-01-31'},
    {startDate:'2026-03-01',endDate:'2026-03-31'}
  ]);
  assert.deepEqual(metrics.find(x=>x.uid==='PERI0003').windows,[
    {startDate:'2026-04-01',endDate:'2026-04-30'}
  ]);
  const counts=fourDimensionDailyCounts({
    selected:metrics,
    sourceRows:[
      {day:'2026-01-15',kind:'total',item_count:2},
      {day:'2026-02-10',kind:'total',item_count:10},
      {day:'2026-03-10',kind:'total',item_count:3},
      {day:'2026-04-02',kind:'total',item_count:1}
    ]
  });
  assert.equal(dayCount(counts,era,'2026-01-15'),2);
  assert.equal(dayCount(counts,era,'2026-02-10'),0);
  assert.equal(dayCount(counts,era,'2026-03-10'),3);
  assert.equal(dayCount(counts,era,'2026-04-02'),0);
  assert.equal(dayCount(counts,metrics.find(x=>x.uid==='PERI0003'),'2026-04-02'),1);
});

test('Trace counts linked Path points and direct points once per real place/day/site',()=>{
  const metrics=spaceIntersectionMetrics(places);
  assert.deepEqual(metrics.map(x=>x.kind),['trace','path','path']);
  const trace=metrics.find(x=>x.kind==='trace');
  assert.deepEqual([...trace.points].sort(),['POIN0001','POIN0002']);
  assert.deepEqual(trace.children,['PATH0001']);
  const counts=fourDimensionDailyCounts({
    selected:metrics,
    placeRows:[
      {day:'2026-01-15',place_id:'POIN0001',site:'Facebook',item_count:2},
      {day:'2026-01-15',place_id:'POIN0002',site:'Suno',item_count:3},
      {day:'2026-01-15',place_id:'FAKE0001',site:'Facebook',item_count:9}
    ]
  });
  assert.equal(dayCount(counts,trace,'2026-01-15'),5);
  assert.equal(dayCount(counts,metrics.find(x=>x.uid==='PATH0001'),'2026-01-15'),5);
  assert.equal(dayCount(counts,metrics.find(x=>x.uid==='PATH0002'),'2026-01-15'),3);
});

test('one SiteAnchor rollup includes multimedia but offers only Galaxy/Domain',()=>{
  const taxonomy=publishedSourceTaxonomy(),nodes=sourceIntersectionMetrics(taxonomy);
  assert.ok(nodes.length>0);
  assert.ok(nodes.every(node=>node.kind==='source_tree'&&
    ['galaxy','domain'].includes(node.type)));
  assert.ok(!nodes.some(node=>['Facebook','Suno','Youtube','Spotify'].includes(node.name)));
  const byName=new Map(nodes.map(node=>[node.name,node]));
  const counts=fourDimensionDailyCounts({
    selected:nodes,taxonomy,
    sourceRows:[
      {day:'2026-01-15',kind:'source',category:'Facebook',item_count:2},
      {day:'2026-01-15',kind:'source',category:'Threads',item_count:3},
      {day:'2026-01-15',kind:'source',category:'suno',item_count:1},
      {day:'2026-01-15',kind:'source',category:'Unmapped service',item_count:10},
      {day:'2026-01-15',kind:'total',category:'文字作品',item_count:16}
    ]
  });
  assert.equal(dayCount(counts,byName.get('Meta'),'2026-01-15'),5);
  assert.equal(dayCount(counts,byName.get('CMS'),'2026-01-15'),5);
  assert.equal(dayCount(counts,byName.get('Music'),'2026-01-15'),1);
  assert.equal(dayCount(counts,byName.get('Stream'),'2026-01-15'),1);
  assert.equal(byName.has('Mutlimedia'),false); // Universe is navigation only
  assert.equal(byName.has('Yesterday'),true); // PastBy > SeeYou > Yesterday
});

test('Statistics space comparisons require both trace and statics without changing Trace territory',()=>{
  const ui=readFileSync(new URL('../app/modular/modules/statistics/ScopeSelfIntersection.jsx',import.meta.url),'utf8');
  const sql=readFileSync(new URL('../app/loc/providers/kysely-analytics.mjs',import.meta.url),'utf8');
  assert.match(ui,/p_options:\{withPoints:false,statisticsOnly:true\}/);
  assert.match(sql,/async function traceTerritory\(trx,scope,start,end,\{withPoints=false,statisticsOnly=false\}/);
  assert.match(sql,/const statisticsFilter=statisticsOnly\s*\?sql`and g\.statics is true and g\.trace is true`/);
  assert.match(sql,/if\(options\.statisticsOnly===true\)query=query\.where\('statics','=',true\)\s*\.where\('trace','=',true\)/);
  assert.match(sql,/statisticsOnly:options.statisticsOnly===true/);
});

test('public analytics accepts dual-flag Statistics filter only for places and territory',()=>{
  const source=readFileSync(new URL('../app/loc/server/public-named-transactions.mjs',
    import.meta.url),'utf8');
  assert.match(source,/'withPoints','statisticsOnly'\]\)/);
  assert.match(source,/if\(options\.statisticsOnly!==undefined&&/);
  assert.match(source,/!\['trace_places','trace_territory'\]\.includes\(view\)/);
  assert.match(source,/typeof options\.statisticsOnly!=='boolean'/);
  const ui=readFileSync(new URL('../app/modular/modules/statistics/ScopeSelfIntersection.jsx',
    import.meta.url),'utf8');
  assert.match(ui,/p_options:\{withPoints:false,statisticsOnly:true\}/);
});

test('Statistics places require both switches while Trace keeps its own feature reads',()=>{
  const stats=readFileSync(new URL('../app/modular/features/Statistics.jsx',import.meta.url),'utf8');
  const trace=readFileSync(new URL('../app/modular/features/trace/TraceTerritoryPanel.jsx',import.meta.url),'utf8');
  const sql=readFileSync(new URL('../app/loc/providers/kysely-analytics.mjs',import.meta.url),'utf8');
  assert.match(stats,/p_view:'trace_places'[\\s\\S]*?p_options:\\{statisticsOnly:true\\}/);
  assert.match(trace,/p_view:'trace_territory'[\\s\\S]*?p_options:\\{withPoints:true\\}/);
  assert.match(sql,/where trace is true \\$,?\\{statisticsFilter\\} and date is not null/);
  assert.match(sql,/if\\(opts.requireStatics===true\\)query=query.where\\('statics','=',true\\)/);
  assert.match(sql,/const rows=await grouped\\('trace',\\['date','location'\\],\\{/);
  assert.match(sql,/requireStatics:options.statisticsOnly===true/);
});

test('all four families are present in the cascading metric picker',()=>{
  const mk=(name,id)=>({name,id});
  const groups=comparisonMetricGroups('all',{
    time:[{name:'Era',item:mk('ERA','era\u0000UID00001'),items:[]}],
    space:[{name:'Trace',item:mk('TRACE','trace\u0000UID00002'),items:[]}],
    keyword:[{name:'Group',item:mk('GROUP','keyword_group\u0000UID00003'),items:[]}],
    source:[{name:'Galaxy',item:mk('CMS','source_galaxy\u0000UID00004'),items:[]}]
  });
  assert.deepEqual(labels(groups),['Era','Trace','Group','Galaxy']);
  assert.equal(new Set(groups.flatMap(x=>x.options).map(x=>x.id)).size,4);
});
