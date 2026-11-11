import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {parse} from '@babel/parser';
import {summarizeCultureRiverRoots,selectCultureRiverChildren,buildCultureRiverRootPayload} from '../app/loc/culture-river-roots.mjs';
const taxonomy={
  categories:[{category_code:'facebook',enabled:true},{category_code:'others',enabled:true}],
  aliases:[{source_key:'facebook',category_code:'facebook'}]
};
const rows=[
  {day:'2026-10-01',kind:'source',category:'Facebook',item_count:4},
  {day:'2026-10-01',kind:'source',category:'Website',item_count:2},
  {day:'2026-10-01',kind:'media',category:'music',item_count:3},
  {day:'2026-10-01',kind:'total',category:'文字作品',item_count:6},
  {day:'2026-10-01',kind:'total',category:'多媒體',item_count:3},
  {day:'2026-10-02',kind:'source',category:'Facebook',item_count:1}
];
test('root buckets preserve distinct system, personal and media counts',()=>{
  const summary=summarizeCultureRiverRoots(rows,taxonomy);
  assert.deepEqual(summary.rootBuckets,[
    {category:'custom',start_date:'2026-10-01',item_count:2},
    {category:'media',start_date:'2026-10-01',item_count:3},
    {category:'system',start_date:'2026-10-01',item_count:4},
    {category:'system',start_date:'2026-10-02',item_count:1}
  ]);
  assert.equal(summary.groups.length,3);
});
test('expanded root filter never leaks other source types or top-level totals',()=>{
  assert.deepEqual(selectCultureRiverChildren(rows,taxonomy,['system']).map(x=>x.item_count),[4,1]);
  assert.deepEqual(selectCultureRiverChildren(rows,taxonomy,['custom']).map(x=>x.item_count),[2]);
  assert.deepEqual(selectCultureRiverChildren(rows,taxonomy,['media']).map(x=>x.item_count),[3]);
  assert.equal(selectCultureRiverChildren(rows,taxonomy,[]).length,0);
});

test('first paint summarizes only roots; expanded children reuse same numeric RPC data',()=>{
  const counted={
    text:[
      {day:'2026-10-01',category:'Facebook',item_count:4},
      {day:'2026-10-01',category:'Website',item_count:2},
      {day:'2026-10-02',category:'Facebook',item_count:1},
      {day:'',category:'Facebook',item_count:9}
    ],
    media:[{day:'2026-10-01',category:'music',item_count:3}]
  };
  const data=buildCultureRiverRootPayload(counted,taxonomy);
  assert.deepEqual(data.rootBuckets,[
    {category:'custom',start_date:'2026-10-01',item_count:2},
    {category:'media',start_date:'2026-10-01',item_count:3},
    {category:'system',start_date:'2026-10-01',item_count:4},
    {category:'system',start_date:'2026-10-02',item_count:1}
  ]);
  assert.equal(data.groups.length,3);
  assert.equal(data.numericRows.length,5);
  assert.deepEqual(selectCultureRiverChildren(data.numericRows,taxonomy,['system'])
    .filter(row=>row.day).map(row=>row.item_count),[4,1]);
  assert.deepEqual(selectCultureRiverChildren(data.numericRows,taxonomy,['custom'])
    .map(row=>row.item_count),[2]);
  assert.deepEqual(selectCultureRiverChildren(data.numericRows,taxonomy,['media'])
    .map(row=>row.item_count),[3]);
  assert.equal(selectCultureRiverChildren(data.numericRows,taxonomy,[]).length,0);
});

test('empty and single-source Scopes retain correct parent counts without a child network request',()=>{
  const empty=buildCultureRiverRootPayload({text:[],media:[]},taxonomy);
  assert.deepEqual(empty,{rootBuckets:[],groups:[],numericRows:[]});
  const single=buildCultureRiverRootPayload({
    text:[{day:'2026-10-03',category:'Facebook',item_count:7}],
    media:[]
  },taxonomy);
  assert.deepEqual(single.rootBuckets,[
    {category:'system',start_date:'2026-10-03',item_count:7}
  ]);
  assert.equal(single.groups.length,1);
  assert.equal(single.groups[0].item_count,7);
});

test('progressive Culture component uses SQL once and does not require numeric ISR',()=>{
  const source=readFileSync(new URL('../app/modular/features/Culture.jsx',import.meta.url),'utf8');
  assert.match(source,/const stagedSourceRiver=Boolean\(publishedTaxonomy\)/);
  assert.match(source,/queryFn:async\(\)=>\{\s*const \{text,media\}=await selectScopeDailyCounts\(scopeData/);
  assert.match(source,/return buildCultureRiverRootPayload\(\{/);
  assert.match(source,/text:text\.filter\(inside\),media:media\.filter\(inside\)/);
  assert.match(source,/timePeriodContainsDate\(/);
  assert.match(source,/return selectCultureRiverChildren\(sourceRootQuery\.data\.numericRows,publishedTaxonomy,expandedSourceRoots\)/);
  assert.match(source,/\(!stagedSourceRiver\|\|expandedSourceReady\)/);
  assert.match(source,/numericRows:requestedChildren/);
  assert.doesNotMatch(source,/readNumericIsr|usesNumericIsr|systemChildrenQuery|customChildrenQuery|mediaChildrenQuery/);
  assert.equal((source.match(/await selectScopeDailyCounts\(scopeData/g)||[]).length,1);
});

test('Culture period loading uses declared render focus and imported period intersection helper',()=>{
  // Verify JavaScript bindings, not display wording or regex formatting.
  const culture=readFileSync(new URL('../app/modular/features/Culture.jsx',import.meta.url),'utf8');
  const cultureAst=parse(culture,{sourceType:'module',plugins:['jsx']});
  const topLevelBindings=new Set(cultureAst.program.body
    .filter(node=>node.type==='VariableDeclaration')
    .flatMap(node=>node.declarations)
    .filter(node=>node.id.type==='Identifier')
    .map(node=>node.id.name));
  assert.ok(topLevelBindings.has('EMPTY_RIVER_FOCUS'),'render focus must exist at module scope');
  const query=readFileSync(new URL('../app/loc/culture-query.js',import.meta.url),'utf8');
  const queryAst=parse(query,{sourceType:'module',plugins:['jsx']});
  const rangesImport=queryAst.program.body.find(node=>node.type==='ImportDeclaration'
    &&node.source.value==='./time-anchor-ranges.mjs');
  assert.ok(rangesImport?.specifiers.some(node=>node.type==='ImportSpecifier'
    &&node.imported.name==='timePeriodContainsDate'),
  'LOC culture must import the actual period-range predicate it calls');
});

test('small article pages reuse first COUNT and OFFSET for later pages',()=>{
  const ui=readFileSync(new URL('../app/modular/features/Culture.jsx',import.meta.url),'utf8');
  const query=readFileSync(new URL('../app/loc/culture-query.js',import.meta.url),'utf8');
  const contract=readFileSync(new URL('../app/loc/db-contract.mjs',import.meta.url),'utf8');
  assert.ok(contract.includes('DEFAULT_LIST_BATCH_SIZE=20'));
  assert.ok(query.includes("count:hasCursorCounts?null:'exact'"));
  assert.ok(query.includes('offset:galaxyOffset'));
  assert.ok(query.includes('offset:mediaOffset'));
  assert.ok(ui.includes('totalCount:periodWorksPages[0]?.totalCount'));
});

test('later article pages only append and do not replace earlier visible items',()=>{
  const code=readFileSync(new URL('../app/modular/features/Culture.jsx',import.meta.url),'utf8');
  const start=code.indexOf('  const visibleWorkRows=useMemo(()=>{');
  const end=code.indexOf('  const periodWorksPage=',start);
  assert.ok(start>=0&&end>start);
  const original={key:'galaxy:AAA00001',title:'original'};
  const next={key:'galaxy:BBB00002',title:'new'};
  const pages=[
    {rows:[original],totalCount:2},
    {rows:[{...original,title:'overwritten'},next],totalCount:20}
  ];
  const result=new Function('useMemo','periodWorksPages',
    code.slice(start,end)+';return visibleWorkRows;')(fn=>fn(),pages);
  assert.deepEqual(result,[original,next]);
});

test('vis timeline retains ownership of its geometry while Motion decorates selection and insight',()=>{
  const timeline=readFileSync(new URL('../app/modular/modules/culture-timeline/CultureTimeline.jsx',import.meta.url),'utf8');
  assert.ok(parse(timeline,{sourceType:'module',plugins:['jsx']}).program.body.length>0);
  assert.match(timeline,/import \{AnimatePresence,motion,useReducedMotion\} from 'motion\/react'/);
  assert.match(timeline,/const cameraAnimation=reduceMotion\?false:/);
  assert.match(timeline,/timeline\.zoomIn\(\.35,\{animation:cameraAnimation\}\)/);
  assert.match(timeline,/timeline\.zoomOut\(\.35,\{animation:cameraAnimation\}\)/);
  assert.match(timeline,/timeline\.setWindow\(new Date\(from\+shift\),new Date\(to\+shift\),\{animation:cameraAnimation\}\)/);
  assert.match(timeline,/className='scope-timeline-focus-pill'/);
  assert.match(timeline,/className='scope-candidate-insight'/);
  assert.match(timeline,/instance\.fit\(\{animation:false\}\)/);
  assert.match(timeline,/timeline\.redraw\(\)/);
  assert.match(timeline,/instance\.destroy\(\)/);
  // The vis-owned container stays a plain element with its original ref.
  assert.match(timeline,/<div ref=\{containerRef\} data-anchor-gesture=/);
  assert.doesNotMatch(timeline,/<motion\.div ref=\{containerRef\}/);
  const style=readFileSync(new URL('../app/styles/scope-system.css',import.meta.url),'utf8');
  assert.match(style,/\.scope-timeline-focus-slot\{/);
  assert.match(style,/min-height:44px/);
});
