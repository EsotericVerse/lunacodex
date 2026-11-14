import assert from 'node:assert/strict';
import {withPublicSqlResultCache} from '../app/loc/server/sql-result-cache.mjs';

const revisions=new Map([
  ['silver.loc','1'],['silver.loc_anchor','7'],
  ['silver.lo3rwang','1'],['silver.lrunes','2'],
  ['silver.lo3rwang_blocks','3'],['silver.lrunes_blocks','5'],
  ['silver.lo3rwang_galaxy','9'],['silver.lrunes_galaxy','4']
]);
let revisionReads=0;
let failRevision=false;
const db={selectFrom(table){
  assert.equal(table,'api.loc_sql_result_revision');
  return {select(columns){
    assert.deepEqual(columns,['relation','revision']);
    return {where(column,op,names){
      assert.equal(column,'relation');assert.equal(op,'in');
      return {async execute(){
        revisionReads++;
        if(failRevision)throw Error('version table unavailable');
        return names.filter(name=>revisions.has(name))
          .map(name=>({relation:name,revision:revisions.get(name)}));
      }};
    }};
  }};
}};
let reads=0;
const baseline={env:{LOC_SQL_RESULT_CACHE:'1'},db,engine:'postgres',
  namespace:'silver',targetId:'main',scope:'lo3rwang',
  kind:'config',dependencies:['silver.lo3rwang']};
const get=(options={})=>withPublicSqlResultCache({...baseline,...options,
  read:options.read??(async()=>({value:++reads}))});

assert.deepEqual(await get(),{value:1});
assert.deepEqual(await get(),{value:1});
assert.equal(reads,1,'same publicly readable config and epoch reuse SQL result');
await get({scope:'lrunes',dependencies:['silver.lrunes']});
assert.equal(reads,2,'public config Scopes isolated');
revisions.set('silver.lrunes','3');
assert.deepEqual(await get(),{value:1});
assert.equal(reads,2,'unrelated config write preserves other Scope cache');
revisions.set('silver.lo3rwang','2');
assert.deepEqual(await get(),{value:3});
assert.equal(reads,3,'config mutation invalidates its own Scope');

const locBlock={scope:'loc',kind:'block_list',dependencies:['silver.loc_anchor']};
await get(locBlock);
await get(locBlock);
assert.equal(reads,4,'LOC Blocks project from loc_anchor');
await get({scope:'lo3rwang',kind:'block_list',
  dependencies:['silver.lo3rwang_blocks']});
assert.equal(reads,5,'Scope Blocks use their own physical table');
revisions.set('silver.loc_anchor','8');
await get(locBlock);
assert.equal(reads,6,'LOC Anchor mutation invalidates LOC Blocks');
await get({scope:'lo3rwang',kind:'block_list',
  dependencies:['silver.lo3rwang_blocks']});
assert.equal(reads,6,'LOC Anchor mutation does not clear other Scope Blocks');

await get({scope:'loc',kind:'hero_block',feature:'group_search',
  dependencies:['silver.loc_anchor']});
await get({scope:'loc',kind:'hero_block',feature:'group_culture',
  dependencies:['silver.loc_anchor']});
assert.equal(reads,8,'different Hero types never share results');
await get({scope:'loc',kind:'hero_block',feature:'group_search',
  dependencies:['silver.loc_anchor']});
assert.equal(reads,8,'same Hero type and epoch reuse');
await get({scope:'loc',kind:'culture_anchors',
  dependencies:['silver.loc_anchor']});
assert.equal(reads,9,'source/time Anchor projection remains distinct from Hero');

await get({kind:'loc',scope:'loc',dependencies:[
  'silver.lo3rwang_galaxy','silver.lrunes_galaxy']});
assert.equal(reads,10,'LOC numeric group depends on both Galaxy revisions');
revisions.set('silver.lrunes_galaxy','5');
await get({kind:'loc',scope:'loc',dependencies:[
  'silver.lo3rwang_galaxy','silver.lrunes_galaxy']});
assert.equal(reads,11,'changing one participating Galaxy invalidates group sum');

await get({targetId:'mirror'});
assert.equal(reads,12,'cache never crosses selected database targets');
await get({dependencies:['silver.loc_blocks']});
assert.equal(reads,13,'retired LOC Blocks physical table is not cacheable');
await get({dependencies:['api.manage']});
assert.equal(reads,14,'Auth grants are not a valid cache dependency');
await get({dependencies:['silver.unversioned_blocks']});
assert.equal(reads,15,'tables without valid revisions stay live');
failRevision=true;
await get();
assert.equal(reads,16,'failed revision SELECT falls back to trusted live reader');
failRevision=false;
await get({engine:'mysql'});
assert.equal(reads,17,'MySQL stays live without PostgreSQL revision backing');

let oversized=0;
const big={...baseline,scope:'bigconfig',read:async()=>{
  oversized++;
  return 'x'.repeat(350001);
}};
await get(big);await get(big);
assert.equal(oversized,2,'large payload must not persist in result cache');

let unsets=0;
const unset={...baseline,scope:'unsetconfig',read:async()=>{unsets++;return undefined;}};
const unsetResults=await Promise.all([
  withPublicSqlResultCache(unset),withPublicSqlResultCache(unset)
]);
assert.deepEqual(unsetResults,[undefined,undefined],
  'undefined results must not crash on parallel reads');
console.log('LOC public SQL result cache: 18 scenarios PASS');
