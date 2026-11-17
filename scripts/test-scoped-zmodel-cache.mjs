import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  scopedReadRelation,getOrLoadScopedRead,invalidateScopedReadCache,
  scopedReadCacheStats
} from '../packages/zenstack/scoped-read-cache.mjs';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('ZModel Scope identity includes every Anchor/Blocks table, never Galaxy or idx',()=>{
  for(const name of ['silver.loc_anchor','silver.lo3rwang_anchor',
    'silver.lrunes_anchor','silver.someone_anchor',
    'silver.lo3rwang_blocks','silver.lrunes_blocks','silver.someone_blocks']){
    const model=scopedReadRelation(name);
    assert.ok(model,name);
    assert.equal(model.name,name);
    assert.ok(/Anchor$|Blocks$/.test(model.modelName));
  }
  for(const name of ['silver.loc_blocks','silver.loc_galaxy',
    'silver.lo3rwang_galaxy','silver.someone_galaxy',
    'api.manage','silver.local_anchor','silver.someone_idx']){
    assert.equal(scopedReadRelation(name),null,name);
  }
  assert.notEqual(scopedReadRelation('silver.loc_anchor').modelName,
    scopedReadRelation('silver.lo3rwang_anchor').modelName);
});

test('public Anchor/Blocks share one completed ZModel query, no TTL or duplicate SQL',async()=>{
  invalidateScopedReadCache();
  let count=0;
  const load=async()=>{count++;return {rows:[{uid:'ABCDEFGH'}],dataSource:'primary'};};
  const descriptor=['rows','uid,type,title',[{column:'type',value:'date'}],0,100];
  const [a,b]=await Promise.all([
    getOrLoadScopedRead('silver.lo3rwang_anchor',descriptor,load),
    getOrLoadScopedRead('silver.lo3rwang_anchor',descriptor,load)
  ]);
  const c=await getOrLoadScopedRead('silver.lo3rwang_anchor',descriptor,load);
  assert.equal(count,1);
  assert.equal(a,b);assert.equal(b,c);
  assert.equal(scopedReadCacheStats().entries,1);
  invalidateScopedReadCache('silver.lo3rwang_anchor');
  await getOrLoadScopedRead('silver.lo3rwang_anchor',descriptor,load);
  assert.equal(count,2);
  invalidateScopedReadCache();
});

test('same UID across scopes does not share records; no cache for Galaxy',async()=>{
  invalidateScopedReadCache();
  let count=0;
  const load=async()=>({rows:[{uid:'ABCDEFGH',value:++count}],dataSource:'primary'});
  const key=['uid','ABCDEFGH'];
  const loc=await getOrLoadScopedRead('silver.loc_anchor',key,load);
  const lo3=await getOrLoadScopedRead('silver.lo3rwang_anchor',key,load);
  assert.notEqual(loc,lo3);
  assert.equal(count,2);
  await getOrLoadScopedRead('silver.lo3rwang_galaxy',key,load);
  await getOrLoadScopedRead('silver.lo3rwang_galaxy',key,load);
  assert.equal(count,4);
  invalidateScopedReadCache();
});

test('an older in-flight Anchor read never refills a cache after mutation',async()=>{
  invalidateScopedReadCache();
  let resolveOld;
  const first=getOrLoadScopedRead('silver.loc_anchor',['uid','ABCDEFGH'],
    ()=>new Promise(resolve=>{resolveOld=resolve;}));
  await Promise.resolve();
  invalidateScopedReadCache('silver.loc_anchor');
  resolveOld({rows:[{uid:'ABCDEFGH',title:'old'}],dataSource:'primary'});
  await first;
  const fresh=await getOrLoadScopedRead('silver.loc_anchor',['uid','ABCDEFGH'],
    async()=>({rows:[{uid:'ABCDEFGH',title:'new'}],dataSource:'primary'}));
  assert.equal(fresh.rows[0].title,'new');
  invalidateScopedReadCache();
});

test('a failed SELECT and a backup response are not retained as the primary read',async()=>{
  invalidateScopedReadCache();
  let n=0;
  await assert.rejects(getOrLoadScopedRead('silver.lo3rwang_anchor','error',
    async()=>{n++;throw Error('SQL unavailable');}),/SQL unavailable/);
  await getOrLoadScopedRead('silver.lo3rwang_anchor','error',
    async()=>{n++;return {rows:[],dataSource:'primary'};});
  assert.equal(n,2);
  const fn=async()=>{n++;return {rows:[],dataSource:'backup'};};
  await getOrLoadScopedRead('silver.lo3rwang_blocks','fallback',fn,
    {cacheable:result=>result.dataSource==='primary'});
  await getOrLoadScopedRead('silver.lo3rwang_blocks','fallback',fn,
    {cacheable:result=>result.dataSource==='primary'});
  assert.equal(n,4);
  invalidateScopedReadCache();
});

test('all read/write entry points use the same ZModel cache (no idx/IndexedDB)',()=>{
  const scope=read('app/loc/scope/scope-data.js');
  const query=read('app/loc/db/db-query.mjs');
  const transport=read('app/loc/providers/configured.mjs');
  const keywords=read('app/loc/keywords/service-client.mjs');
  const directWriter=read('app/loc/db/db-contract.mjs');
  const store=read('packages/zenstack/scoped-read-cache.mjs');
  assert.match(scope,/getOrLoadScopedRead\(blockRelation\(id\)/);
  assert.match(scope,/getOrLoadScopedRead\('silver.loc_anchor'/);
  assert.doesNotMatch(scope,/const scopeBlocksRequests=new Map/);
  assert.doesNotMatch(scope,/const blockListRequests=new Map/);
  assert.match(query,/getOrLoadScopedRead\(table,signature/);
  assert.match(transport,/invalidateScopedReadCache\(payload\?\.p_table\)/);
  assert.match(transport,/name==='save_blocks'/);
  assert.match(keywords,/invalidateScopedReadCache\('silver\.'\+scope\+'_anchor'\)/);
  assert.match(directWriter,/invalidateScopedReadCache\(table\)/);
  assert.match(store,/modelNameForSql/);
  assert.doesNotMatch(store,/indexedDB|localStorage|setTimeout|Date\.now\(/);
});

test('PR #1759 analysis checkpoints do not invalidate Anchor until completion',()=>{
  const client=read('app/loc/keywords/service-client.mjs');
  const analysis=read('app/loc/keywords/analysis.js');
  const sql=read('app/loc/keywords/sql-service.mjs');
  assert.match(analysis,/result\?\.incomplete/);
  assert.match(sql,/return \{incomplete:true/);
  const start=client.indexOf('  const committed=result=>{');
  const end=client.indexOf('  const readSignal=',start);
  assert.ok(start>0&&end>start,'keyword cache completion guard is missing');
  const factory=new Function('operation','write','scope','invalidateScopedReadCache',
    client.slice(start,end)+'\nreturn committed;');
  const touched=[];
  const invalidate=relation=>touched.push(relation);
  const analysisWrite=factory('analyze',true,'lo3rwang',invalidate);
  analysisWrite({incomplete:true,completed:300,total:500});
  assert.equal(touched.length,0,'unfinished analysis must preserve published Pattern cache');
  analysisWrite({incomplete:false,analyzedDocuments:500});
  assert.deepEqual(touched,['silver.lo3rwang_anchor']);
  const receipt=factory('analyzeStatus',false,'lo3rwang',invalidate);
  receipt({completed:false});
  assert.equal(touched.length,1);
  receipt({completed:true,result:{analyzedDocuments:500}});
  assert.equal(touched.length,2);
  factory('saveItem',true,'lo3rwang',invalidate)({uid:'ABCDEFGH'});
  assert.equal(touched.length,3);
});
