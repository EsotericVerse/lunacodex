import test from 'node:test';
import assert from 'node:assert/strict';
import {mediaSiteSources,mediaSiteDailyRows}
  from '../app/loc/statistics/media-site-statistics.mjs';
import {parseGalaxyFeatureTransaction,executeGalaxyFeatureTransaction}
  from '../app/loc/model/galaxy-feature-transactions.mjs';

test('published multimedia SiteAnchor, not media_link, defines media sources',()=>{
  const sources=mediaSiteSources();
  assert.ok(sources.includes('Suno'));
  assert.ok(sources.includes('Spotify'));
  assert.ok(sources.includes('Youtube'));
  assert.ok(!sources.includes('Vocus'));
  assert.ok(!sources.includes('Facebook'));
});
test('media statistics preserve the exact Galaxy.site grouping',()=>{
  const data=mediaSiteDailyRows([
    {kind:'source',day:'2026-11-22',category:'suno',item_count:4},
    {kind:'source',day:'2026-11-22',category:'Vocus',item_count:9},
    {kind:'total',day:'2026-11-22',category:'文字作品',item_count:13},
    {kind:'source',day:'2026-11-22',category:'Spotify',item_count:2}
  ]);
  assert.deepEqual(data,[
    {day:'2026-11-22',category:'suno',item_count:4},
    {day:'2026-11-22',category:'Spotify',item_count:2}
  ]);
});
test('LOC global statics source grouping is the only allowed cross-Scope model',()=>{
  const model={kind:'transaction',operation:'galaxy-feature',scope:'loc',
    feature:'statics',result:'daily-sources',sources:['Suno']};
  assert.equal(parseGalaxyFeatureTransaction(model).scope,'loc');
  for(const patch of [{feature:'culture'},{result:'articles'},
    {sources:undefined},{result:'uids'},{feature:'extract'}])
    assert.throws(()=>parseGalaxyFeatureTransaction({...model,...patch}));
});
test('LOC global media counts use server-published Scopes in one transaction',async()=>{
  const seen=[];
  const q={
    where(...args){seen.push(args);return this},
    select(){return this},groupBy(){return this},orderBy(){return this},
    async execute(){return [{date:'2026-11-22',site:'Suno',count:3}]}
  };
  const trx={selectFrom(table){seen.push(['relation',table]);return q}};
  const model=parseGalaxyFeatureTransaction({kind:'transaction',
    operation:'galaxy-feature',scope:'loc',feature:'statics',
    result:'daily-sources',sources:['Suno']});
  const result=await executeGalaxyFeatureTransaction(trx,model);
  assert.deepEqual(result.rows,[{day:'2026-11-22',kind:'source',
    category:'Suno',item_count:6}]);
  assert.ok(seen.some(row=>row[0]==='relation'&&row[1]==='silver.lo3rwang_galaxy'));
  assert.ok(seen.some(row=>row[0]==='relation'&&row[1]==='silver.lrunes_galaxy'));
  assert.ok(seen.some(row=>row[0]==='statics'&&row[2]===true));
  assert.ok(!seen.some(row=>row[0]==='media_link'));
});
