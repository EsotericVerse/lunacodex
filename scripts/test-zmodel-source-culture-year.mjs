import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sourceTaxonomyFromAnchors} from '../app/loc/source-classification.mjs';
import {assignedSource} from '../app/loc/member-intersection-model.mjs';
import {sourceKeywordOptions} from '../app/loc/source-keyword-options.mjs';
import {buildCultureRiverRootPayload,selectCultureRiverChildren} from '../app/loc/culture-river-roots.mjs';
import {administrativeSourceTrend} from '../app/loc/statistics-admin-source.mjs';
import {DEFAULT_YEAR_WINDOW} from '../app/loc/default-year-window.mjs';

const anchor=(uid,type,title,children=[])=>({uid,type,title,invisible:false,attr:{uid:children}});
const sourceNodes=[
  anchor('itKaEYUy','universe','Words',['TyoLbF13','q1FEUuCT']),
  anchor('TyoLbF13','galaxy','CMS',['lKHpyq5y']),
  anchor('lKHpyq5y','domain','Meta',['COAzlF1J']),
  anchor('COAzlF1J','from','Facebook'),
  anchor('q1FEUuCT','galaxy','Article',['dDlnxRgY']),
  anchor('dDlnxRgY','domain','Post',['ckEJRvZI']),
  anchor('ckEJRvZI','from','Vocus'),
  anchor('KRHRwlxI','universe','Mutlimedia',['6Uux1N5h']),
  anchor('6Uux1N5h','galaxy','Stream',['YvfSMof1']),
  anchor('YvfSMof1','domain','Music',['2gZPxjs6']),
  anchor('2gZPxjs6','from','Suno'),
  anchor('OQP27bj0','universe','PastBy',['hxhIZtxB']),
  anchor('hxhIZtxB','galaxy','SeeYou',['aFvTLnJc']),
  anchor('aFvTLnJc','domain','Yesterday',['XBbYV2cc']),
  anchor('XBbYV2cc','from','無名wretch')
];

const taxonomy=sourceTaxonomyFromAnchors(sourceNodes);
const daily=[
  {kind:'source',day:'2025-06-03',category:'suno',item_count:5},
  {kind:'source',day:'2025-06-03',category:'Facebook',item_count:3},
  {kind:'source',day:'2025-06-03',category:'vocus',item_count:2},
  {kind:'source',day:'2025-06-03',category:'wretch',item_count:1}
];
const sourceFor=site=>assignedSource(site,taxonomy.aliases,taxonomy.categories);

test('ZModel Source taxonomy preserves exact 8-character UIDs and Ancestor UID paths',()=>{
  assert.equal(taxonomy.tree.length,sourceNodes.length);
  assert.deepEqual(taxonomy.roots.map(node=>node.title),['Words','Mutlimedia','PastBy']);
  assert.deepEqual(taxonomy.tree.find(n=>n.uid==='2gZPxjs6')?.path,
    ['KRHRwlxI','6Uux1N5h','YvfSMof1','2gZPxjs6']);
  assert.equal(taxonomy.tree.find(n=>n.uid==='2gZPxjs6')?.root,'media');
  assert.equal(taxonomy.tree.find(n=>n.uid==='XBbYV2cc')?.root,'custom');
  assert.equal(sourceFor('Facebook'),'COAzlF1J');
  assert.equal(sourceFor('suno'),'2gZPxjs6');
  assert.equal(sourceFor('vocus'),'ckEJRvZI');
  assert.equal(sourceFor('wretch'),'XBbYV2cc');
  assert.equal(sourceFor('unknown'),'others');
  assert.ok(sourceKeywordOptions(taxonomy).some(item=>
    item.code==='2gZPxjs6'&&item.root==='media'&&
    item.domain.includes('Mutlimedia / Stream / Music')));
});

test('Culture source river places Suno under the existing Multimedia Universe, not a second media source',()=>{
  const root=buildCultureRiverRootPayload({text:daily,media:[]},taxonomy);
  const counts=Object.fromEntries(root.rootBuckets.map(row=>[row.category,row.item_count]));
  assert.equal(counts.media,5);
  assert.equal(counts.system,5);
  assert.equal(counts.custom,1);
  assert.equal(root.groups.length,4);
  assert.equal(root.groups.filter(item=>item.category_type==='media').length,0);
  const children=selectCultureRiverChildren(root.numericRows,taxonomy,['media']);
  assert.deepEqual(children.map(row=>row.category),['suno']);
});

test('Statistics Domain filter expands only its existing From descendants',()=>{
  const meta=administrativeSourceTrend(daily,taxonomy,{
    startDate:'2025-06-01',endDate:'2025-06-30',unit:'month',
    sourceCategory:'lKHpyq5y'
  });
  assert.equal(meta.total,3);
  assert.deepEqual(meta.distribution.map(x=>x.name),['Facebook']);
  const music=administrativeSourceTrend(daily,taxonomy,{
    startDate:'2025-06-01',endDate:'2025-06-30',unit:'month',
    sourceCategory:'YvfSMof1'
  });
  assert.equal(music.total,5);
  assert.deepEqual(music.distribution.map(x=>x.name),['Suno']);
});

test('Culture and Statistics start on exact 2025 calendar year, independent of saved Era',()=>{
  assert.deepEqual(DEFAULT_YEAR_WINDOW,{startDate:'2025-01-01',
    endDate:'2025-12-31',label:'2025 年（全年）'});
  const sources={
    statistics:'../app/modular/features/Statistics.jsx',
    culture:'../app/modular/features/Culture.jsx',
    group:'../app/modular/modules/statistics/ScopeGroupStatistics.jsx',
    catalog:'../app/loc/source-catalog-public.mjs'
  };
  const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
  const statistics=read(sources.statistics),culture=read(sources.culture);
  assert.match(statistics,/useState\('year'\)/);
  assert.match(statistics,/selectedPeriodKey==='year'/);
  assert.match(culture,/useState\('year'\)/);
  assert.match(culture,/keywordPeriodKey==='year'/);
  assert.match(culture,/defaultYearPeriod/);
  assert.match(read(sources.group),/DEFAULT_YEAR_WINDOW\.startDate/);
  assert.match(read(sources.catalog),/\.from\('loc_anchor'\)/);
  assert.doesNotMatch(statistics,/publishedSourceTaxonomy/);
  assert.doesNotMatch(culture,/publishedSourceTaxonomy/);
});
