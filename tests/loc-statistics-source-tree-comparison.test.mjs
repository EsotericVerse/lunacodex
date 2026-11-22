import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {publishedSourceTaxonomy}
  from '../app/modular/published-source-taxonomy.js';
import {sourceStatisticsTree,sourceTreeMetricId,SOURCE_UNCLASSIFIED_METRIC,
  sourceIntersectionOutline}
  from '../app/loc/statistics/source-tree-measures.mjs';

const taxonomy=publishedSourceTaxonomy();
const treeByTitle=new Map(taxonomy.tree.map(item=>[item.title,item]));
const stat=(name,result)=>result.totals.get(sourceTreeMetricId(treeByTitle.get(name).uid))||0;
const row=(site,count,extra={})=>({
  kind:'source',day:'2026-11-22',category:site,item_count:count,...extra
});
const code=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('all multi-item Source choices use the 30 LOC source UID nodes at four exact levels',()=>{
  const model=sourceStatisticsTree([],taxonomy);
  assert.deepEqual(model.metrics.map(x=>[x.type,x.level]).filter(x=>x[1]===0).map(x=>x[0]),
    ['universe','universe','universe']);
  assert.equal(model.metrics.length,30);
  assert.equal(model.metrics.filter(item=>item.type==='galaxy').length,4);
  assert.equal(model.metrics.filter(item=>item.type==='domain').length,7);
  assert.equal(model.metrics.filter(item=>item.type==='from').length,16);
  for(const [a,b] of [['X','X Twitter'],['Post','Vocus'],['Video','Youtube']]){
    const parent=treeByTitle.get(a),child=treeByTitle.get(b);
    assert.equal(child.parentUid,parent.uid);
    assert.equal(model.metrics.find(x=>x.uid===child.uid)?.level,3);
    assert.equal(model.metrics.find(x=>x.uid===parent.uid)?.level,2);
  }
});

test('Universe groups the Source list; only real Galaxy and Domain UIDs are choices',()=>{
  const model=sourceStatisticsTree([
    row('Facebook',2),row('Threads',3),row('Suno',1),row('Youtube',1)
  ],taxonomy);
  const grouped=sourceIntersectionOutline(model.metrics);
  assert.deepEqual(grouped.map(group=>group.name),['Words','Mutlimedia','PastBy']);
  const galaxies=grouped.flatMap(group=>group.galaxies);
  const domains=galaxies.flatMap(galaxy=>galaxy.domains);
  assert.equal(galaxies.length,4);
  assert.equal(domains.length,7);
  assert.equal(galaxies.find(g=>g.name==='CMS').domains.find(d=>d.name==='Meta').total,5);
  assert.ok(galaxies.every(item=>item.type==='galaxy'));
  assert.ok(domains.every(item=>item.type==='domain'));
  assert.ok(!galaxies.some(item=>item.type==='universe'||item.type==='from'));
  assert.ok(!domains.some(item=>item.type==='from'));
  assert.ok(!grouped.some(group=>Object.hasOwn(group,'id')));
  const picker=code('app/modular/modules/statistics/SourceTreePicker.jsx');
  const comparison=code('app/modular/modules/statistics/ScopeSelfIntersection.jsx');
  assert.match(comparison,/selectableTypes=\{\['galaxy','domain'\]\}/);
  assert.match(picker,/sourceGroups\.map\(universe/);
  assert.match(picker,/universe\.galaxies\.map\(galaxy/);
  assert.match(picker,/galaxy\.domains\.map\(domain/);
  assert.match(picker,/if\(groupedIntersection\)return/);
});

test('each native From rolls up exactly once along its saved Universe/Galaxy/Domain path',()=>{
  const model=sourceStatisticsTree([
    row('Facebook',2,{site_id:'1627699893985158:0'}),
    row('Threads',3,{site_id:'threads-native-22'}),
    row('vocus',7),
    row('Suno',4,{media_link:['https://suno.com/song/example']}),
    row('Spotify',5),
    row('Youtube',6,{site_id:'YT-native-video-id'}),
    row('ptt',3),
    row('unknown-platform',8)
  ],taxonomy);
  assert.equal(stat('Words',model),12);
  assert.equal(stat('CMS',model),5);
  assert.equal(stat('Meta',model),5);
  assert.equal(stat('Facebook',model),2);
  assert.equal(stat('Threads',model),3);
  assert.equal(stat('Article',model),7);
  assert.equal(stat('Post',model),7);
  assert.equal(stat('Vocus',model),7);
  assert.equal(stat('Mutlimedia',model),15);
  assert.equal(stat('Stream',model),15);
  assert.equal(stat('Music',model),9);
  assert.equal(stat('Suno',model),4);
  assert.equal(stat('Spotify',model),5);
  assert.equal(stat('Video',model),6);
  assert.equal(stat('Youtube',model),6);
  assert.equal(stat('PastBy',model),3);
  assert.equal(stat('Yesterday',model),3);
  assert.equal(model.totals.get(SOURCE_UNCLASSIFIED_METRIC),8);
  // A parent selected as its own comparison lane is a single rolled-up
  // metric, not a second pass that adds its already counted children again.
  const facebookId=sourceTreeMetricId(treeByTitle.get('Facebook').uid);
  const metaId=sourceTreeMetricId(treeByTitle.get('Meta').uid);
  assert.equal(model.metricIdsForSite('Facebook').filter(x=>x===metaId).length,1);
  assert.equal(model.metricIdsForSite('Facebook').filter(x=>x===facebookId).length,1);
});

test('source-native site_id and media URL are not Source classification identifiers',()=>{
  const a=sourceStatisticsTree([
    row('Facebook',1,{site_id:'native-post-A',media_link:['https://example.com/image.png']})
  ],taxonomy);
  const b=sourceStatisticsTree([
    row('Facebook',1,{site_id:'loc_anchor_FAKE',media_link:['https://example.com/video.mp4']})
  ],taxonomy);
  assert.deepEqual([...a.totals],[...b.totals]);
  assert.deepEqual(a.metricIdsForSite('Facebook'),
    treeByTitle.get('Facebook').path.map(sourceTreeMetricId));
  assert.deepEqual(a.metricIdsForSite('not-an-anchor'),[SOURCE_UNCLASSIFIED_METRIC]);
});

test('multi-item comparison UI selects Source using real nested UID branches',()=>{
  const source=code('app/modular/modules/statistics/ScopeSelfIntersection.jsx');
  const picker=code('app/modular/modules/statistics/SourceTreePicker.jsx');
  assert.match(source,/sourceStatisticsTree\(rows,catalog\.data\|\|\{\}\)/);
  // The daily SiteAnchor rollup was extracted into the shared four-family
  // aggregation model; the original sourceStatisticsTree remains the only
  // source of platform UID ancestry.
  const intersection=code('app/loc/statistics/four-anchor-intersection.mjs');
  assert.match(intersection,/canonicalSource\.metricIdsForSite\(row\.category\)/);
  assert.match(intersection,/sourceModel\|\|sourceStatisticsTree\(sourceRows,taxonomy\)/);
  assert.match(source,/<SourceTreePicker/);
  assert.match(picker,/<details/);
  assert.match(picker,/<summary>/);
  assert.match(picker,/descendants\.map\(nodeView\)/);
  assert.match(picker,/onChange\(item\.id\)/);
  assert.match(picker,/takenIds\.has\(item\.id\)/);
  assert.doesNotMatch(source,/source_rollup|sourceGroups|othersConfig|resolveOthers/);
  assert.doesNotMatch(source,/row\.kind==='media'|category_type:'media'|sourceRollup/);
});
