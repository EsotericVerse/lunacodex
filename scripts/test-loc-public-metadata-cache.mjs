import assert from 'node:assert/strict';
import {withPublicSqlResultCache} from '../app/loc/server/sql-result-cache.mjs';

const DEFAULT_GENERATION='33333333-3333-4333-8333-333333333333';
const generationByRelation=new Map();
const revisions=new Map([
  ['silver.loc_anchor','10'],
  ['silver.lo3rwang_blocks','1'],
  ['silver.lrunes_blocks','1'],
  ['silver.lo3rwang','7'],
  ['silver.lrunes','7'],
  ['silver.lo3rwang_galaxy','4'],
  ['silver.lrunes_galaxy','3']
]);
let revisionQueries=0;
let failure=false;
const db={selectFrom(relation){
  assert.equal(relation,'api.loc_sql_result_revision');
  return {select(columns){
    assert.deepEqual(columns,['relation','revision','generation']);
    return {where(column,operation,dependencies){
      assert.equal(column,'relation');
      assert.equal(operation,'in');
      return {async execute(){
        revisionQueries++;
        if(failure)throw Error('Database revision source unavailable');
        return dependencies.filter(name=>revisions.has(name))
          .map(relation=>({relation,revision:revisions.get(relation),
            generation:generationByRelation.get(relation)||DEFAULT_GENERATION}));
      }};
    }};
  }};
}};
const env={LOC_SQL_RESULT_CACHE_METADATA:'1'};
const base={env,db,engine:'postgres',namespace:'silver',
  targetId:'primary',family:'metadata',scope:'lo3rwang'};
let reads=0;
const execute=(opts={})=>{
  const {read,...fields}=opts;
  return withPublicSqlResultCache({...base,...fields,
    read:read||(()=>Promise.resolve({value:++reads}))});
};
const config={kind:'config',dependencies:['silver.lo3rwang']};
assert.deepEqual(await execute(config),{value:1});
const previous=await execute(config);
assert.deepEqual(previous,{value:1});
previous.value=444;
assert.deepEqual(await execute(config),{value:1},'caller cannot mutate cache');
assert.equal(reads,1,'repeated identical config is version-gated');

await execute({...config,scope:'lrunes',dependencies:['silver.lrunes']});
assert.equal(reads,2,'two Scope configs never share results');

revisions.set('silver.lo3rwang','8');
assert.deepEqual(await execute(config),{value:3},'external config edit invalidates');
assert.equal(reads,3);

const blocks={kind:'block_list',dependencies:['silver.lo3rwang_blocks']};
await execute(blocks);
assert.equal(reads,4);
revisions.set('silver.lo3rwang','9');
assert.deepEqual(await execute(blocks),{value:4},
  'config change must not invalidate unrelated Blocks');
revisions.set('silver.lo3rwang_blocks','2');
assert.deepEqual(await execute(blocks),{value:5},'Block write invalidates');

const locBlocks={scope:'loc',kind:'block_list',dependencies:['silver.loc_anchor']};
const hero={scope:'loc',kind:'hero_block',feature:'group_statistics',
  dependencies:['silver.loc_anchor']};
await execute(locBlocks);
await execute(hero);
await execute({...hero,feature:'group_search'});
assert.equal(reads,8,'separate Hero types and homepage do not share');
revisions.set('silver.loc_anchor','11');
await execute(locBlocks);
await execute(hero);
assert.equal(reads,10,'LOC Anchor writes invalidate LOC Blocks and Hero');

await execute({kind:'culture_anchors',
  dependencies:['silver.loc_anchor','silver.lo3rwang_anchor']});
assert.equal(reads,11,'missing fallback Anchor revision reads live');
await execute({kind:'culture_anchors',
  dependencies:['silver.loc_anchor','silver.lo3rwang_anchor']});
assert.equal(reads,12,'incomplete multi-relation revision cannot cache');

revisions.set('silver.lo3rwang_anchor','5');
const combinedAnchors={kind:'culture_anchors',
  dependencies:['silver.loc_anchor','silver.lo3rwang_anchor']};
await execute(combinedAnchors);
assert.deepEqual(await execute(combinedAnchors),{value:13},
  'all recorded relations permit reuse');
revisions.set('silver.lo3rwang_anchor','6');
assert.deepEqual(await execute(combinedAnchors),{value:14},
  'one child revision invalidates whole combined result');
revisions.set('silver.loc_anchor','12');
assert.deepEqual(await execute(combinedAnchors),{value:15},
  'other child revision also invalidates combined result');

const groupOptions={family:'numeric',
  env:{LOC_SQL_RESULT_CACHE:'1'},scope:'loc',kind:'loc',
  dependencies:['silver.lrunes_galaxy','silver.lo3rwang_galaxy']};
await execute(groupOptions);
assert.deepEqual(await execute(groupOptions),{value:16},
  'group numeric cache uses a version of every Scope');
revisions.set('silver.lrunes_galaxy','4');
assert.deepEqual(await execute(groupOptions),{value:17},
  'group numeric invalidates when a single Scope changes');

const dbBefore=revisionQueries;
await execute({...config,env:{}});
assert.equal(reads,18,'metadata caching is opt-in');
assert.equal(revisionQueries,dbBefore,'disabled cache does not inspect revisions');

await execute({...config,engine:'mysql'});
assert.equal(reads,19,'MySQL retains live Kysely');
await execute({...config,engine:'mssql'});
assert.equal(reads,20,'MSSQL retains live Kysely');

await execute({kind:'block_list',scope:'loc',dependencies:['silver.loc_blocks']});
assert.equal(reads,21,'retired LOC Blocks never cache');

failure=true;
await execute(config);
assert.equal(reads,22,'revision failure does not serve stale results');
failure=false;

let errorReads=0;
await assert.rejects(execute({...config,scope:'failure-retry',
  read:async()=>{throw Error('SELECT unavailable')}}),
  /SELECT unavailable/);
const unique={...config,scope:'failure-retry',read:async()=>({n:++errorReads})};
assert.deepEqual(await execute(unique),{n:1},'failed read never poisons cache');

const parallel={scope:'loc',kind:'hero_block',feature:'parallel',
  dependencies:['silver.loc_anchor'],read:async()=>{errorReads++;return {n:errorReads}}};
const combined=await Promise.all(Array.from({length:6},()=>execute(parallel)));
assert.equal(new Set(combined.map(x=>x.n)).size,1,'identical reads coalesce');
// Multiple consumers of a SQL projection that returns undefined must not
// JSON.parse(undefined) while an identical request is still in flight.
let undefinedReads=0;
const omitted={...base,scope:'undefined-projection',kind:'hero_block',
  feature:'missing',dependencies:['silver.loc_anchor'],read:async()=>{
    undefinedReads++;
    await new Promise(resolve=>setTimeout(resolve,12));
    return undefined;
  }};
const omittedResults=await Promise.all(
  Array.from({length:4},()=>withPublicSqlResultCache(omitted)));
assert.deepEqual(omittedResults,[undefined,undefined,undefined,undefined]);
assert.equal(undefinedReads,1,'undefined pending readers share the same result');

const targetBefore=reads;
await execute({...config,targetId:'alternate'});
assert.equal(reads,targetBefore+1,
  'cache key includes trusted selected database target');

const readBefore=revisionQueries;
await execute({...config,env:{LOC_SQL_RESULT_CACHE:'1'}});
assert.equal(revisionQueries,readBefore,
  'numeric enable flag never implicitly enables metadata caching');

// A new physical database or reinstalled revision table can restart counters
// at the same integer. The database-generated UUID must break the cache key.
const replacement={kind:'config',scope:'physical-switch',
  dependencies:['silver.lo3rwang']};
const readCountBeforePhysicalSwitch=reads;
await execute(replacement);
assert.equal(reads,readCountBeforePhysicalSwitch+1);
generationByRelation.set('silver.lo3rwang',
  '44444444-4444-4444-8444-444444444444');
await execute(replacement);
assert.equal(reads,readCountBeforePhysicalSwitch+2,
  'same revision but changed relation generation cannot reuse old result');

// Corrupt or incomplete revision metadata must always use live SQL results.
generationByRelation.set('silver.lo3rwang','missing');
const beforeInvalid=reads;
await execute(replacement);
await execute(replacement);
assert.equal(reads,beforeInvalid+2,'invalid generation fails closed');
generationByRelation.delete('silver.lo3rwang');

const beforeInvalidRevision=reads;
revisions.set('silver.lo3rwang','not-an-integer');
await execute(replacement);
await execute(replacement);
assert.equal(reads,beforeInvalidRevision+2,'invalid revision number fails closed');
revisions.set('silver.lo3rwang','9');

console.log('LOC public metadata SQL cache: 27 assertion groups PASS');
