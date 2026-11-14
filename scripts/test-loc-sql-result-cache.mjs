import assert from 'node:assert/strict';
import {withNumericSqlResultCache} from '../app/loc/server/sql-result-cache.mjs';

const generationByRelation=new Map();
const DEFAULT_GENERATION='11111111-1111-4111-8111-111111111111';
const revisions=new Map([
  ['silver.lo3rwang_galaxy','1'],
  ['silver.lrunes_galaxy','3']
]);
let revisionReads=0;
const db={selectFrom(table){
  assert.equal(table,'api.loc_sql_result_revision');
  return {select(columns){
    assert.deepEqual(columns,['relation','revision','generation']);
    return {where(column,operation,names){
      assert.equal(column,'relation');assert.equal(operation,'in');
      return {async execute(){
        revisionReads++;
        return names.filter(name=>revisions.has(name))
          .map(name=>({relation:name,revision:revisions.get(name),
            generation:generationByRelation.get(name)||DEFAULT_GENERATION}));
      }};
    }};
  }};
}};
const opts={env:{LOC_SQL_RESULT_CACHE:'1'},db,engine:'postgres',
  namespace:'silver',targetId:'primary',scope:'lo3rwang',kind:'daily_total',
  start:'2026-11-01',end:'2026-11-14',
  dependencies:['silver.lo3rwang_galaxy']};
let reads=0;
const get=(override={})=>withNumericSqlResultCache({...opts,...override,
  read:override.read??(async()=>({rows:[{item_count:++reads}]}))});
assert.deepEqual(await get(),{rows:[{item_count:1}]});
assert.deepEqual(await get(),{rows:[{item_count:1}]});
assert.equal(reads,1,'identical verified SQL version reuses completed result');

await get({scope:'lrunes',dependencies:['silver.lrunes_galaxy']});
assert.equal(reads,2,'Scope and dependency isolation');

revisions.set('silver.lo3rwang_galaxy','2');
assert.deepEqual(await get(),{rows:[{item_count:3}]});
assert.equal(reads,3,'external committed revision invalidates result');

generationByRelation.set('silver.lo3rwang_galaxy',
  '22222222-2222-4222-8222-222222222222');
assert.deepEqual(await get(),{rows:[{item_count:4}]});
assert.equal(reads,4,
  'replacing the physical database changes generation even at same revision');

await get({start:'2026-11-02'});
assert.equal(reads,5,'date window is part of the SQL result key');

await get({env:{}});
assert.equal(reads,6,'disabled cache always queries live');

await get({engine:'mssql'});
assert.equal(reads,7,'portable fallback is always live');

await get({dependencies:['silver.missing_galaxy']});
assert.equal(reads,8,'unversioned relation never caches');

let parallel=0;
const shared={...opts,scope:'parallel',kind:'earliest',read:async()=>{
  parallel++;await new Promise(resolve=>setTimeout(resolve,20));return {earliest:'2000-01-01'};
}};
const simultaneous=await Promise.all(Array.from({length:5},()=>withNumericSqlResultCache(shared)));
assert.equal(parallel,1,'concurrent requests with equal version coalesce');
assert.equal(simultaneous.length,5);
assert.ok(revisionReads>=5,'cache hits always check live database revisions');
console.log('LOC SQL numeric cache: 9 scenarios PASS');
