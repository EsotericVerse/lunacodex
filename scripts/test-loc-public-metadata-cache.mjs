import assert from 'node:assert/strict';
import {withPublicSqlResultCache} from '../app/loc/server/sql-result-cache.mjs';

const revisions=new Map([
  ['silver.loc_anchor','10'],
  ['silver.lo3rwang_blocks','1'],
  ['silver.lrunes_blocks','1'],
  ['silver.lo3rwang','7'],
  ['silver.lrunes','7'],
  ['silver.lo3rwang_galaxy','4']
]);
let revisionQueries=0;
let failure=false;
const db={selectFrom(relation){
  assert.equal(relation,'api.loc_sql_result_revision');
  return {select(columns){
    assert.deepEqual(columns,['relation','revision']);
    return {where(column,operation,dependencies){
      assert.equal(column,'relation');
      assert.equal(operation,'in');
      return {async execute(){
        revisionQueries++;
        if(failure)throw Error('Database revision source unavailable');
        return dependencies.filter(name=>revisions.has(name))
          .map(relation=>({relation,revision:revisions.get(relation)}));
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

const dbBefore=revisionQueries;
await execute({...config,env:{}});
assert.equal(reads,13,'metadata caching is opt-in');
assert.equal(revisionQueries,dbBefore,'disabled cache does not inspect revisions');

await execute({...config,engine:'mysql'});
assert.equal(reads,14,'MySQL retains live Kysely');
await execute({...config,engine:'mssql'});
assert.equal(reads,15,'MSSQL retains live Kysely');

await execute({kind:'block_list',scope:'loc',dependencies:['silver.loc_blocks']});
assert.equal(reads,16,'retired LOC Blocks never cache');

failure=true;
await execute(config);
assert.equal(reads,17,'revision failure does not serve stale results');
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
console.log('LOC public metadata SQL cache: 16 assertions groups PASS');
