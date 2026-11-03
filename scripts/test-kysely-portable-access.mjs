import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizeCrossEngineQuery,assertCrossEnginePublicRead} from '../app/loc/providers/sql-engine-ports.mjs';

const identity={role:'authenticated',
  claims:{sub:'user_AbC123',provider:'clerk',email:'owner@example.test'}};
const query=(table,operation='select')=>({kind:'query',schema:'silver',table,operation});
function registry(rows){
  return {selectFrom(table){
    assert.equal(table,'silver.manage');
    return {select(fields){
      assert.deepEqual(fields,['id','email','manage_role','active']);
      return {where(column,op,value){
        assert.equal(column,'email');assert.equal(op,'=');
        assert.equal(value,'owner@example.test');
        return {execute:async()=>rows};
      }};
    }};
  }};
}

test('public engine reads only reference tables; private Galaxy remains private',async()=>{
  assertCrossEnginePublicRead(query('runes'));
  await assert.rejects(authorizeCrossEngineQuery(registry([]),query('lo3rwang_galaxy')),
    /authorization adapter/);
  await assert.rejects(authorizeCrossEngineQuery(registry([]),query('runes','delete')),
    /authorization adapter/);
});
test('verified LOC Scope owner can use generic native Kysely SELECT and writes',async()=>{
  const db=registry([{id:'lo3rwang',email:'owner@example.test',
    manage_role:'scope',active:true}]);
  for(const [table,operation] of [['lo3rwang_galaxy','select'],['lo3rwang_anchor','insert'],
    ['lo3rwang_blocks','update'],['lo3rwang','select']]){
    await authorizeCrossEngineQuery(db,query(table,operation),identity);
  }
});
test('Scope owner cannot mutate registry, global settings, or other Scope',async()=>{
  const db=registry([{id:'lo3rwang',email:'owner@example.test',
    manage_role:'scope',active:true}]);
  for(const table of ['manage','loc','lrunes_galaxy','unknown_table']){
    await assert.rejects(authorizeCrossEngineQuery(db,query(table,'update'),identity),
      /permission denied/);
  }
});
test('inactive Scope grants are denied and forged unsigned identity is denied',async()=>{
  const db=registry([{id:'lo3rwang',email:'owner@example.test',
    manage_role:'scope',active:false}]);
  await assert.rejects(authorizeCrossEngineQuery(db,query('lo3rwang_galaxy','insert'),identity),
    /permission denied/);
  await assert.rejects(authorizeCrossEngineQuery(db,query('lo3rwang_galaxy','insert'),
    {role:'authenticated',claims:{email:'owner@example.test'}}),
    /Verified Clerk identity/);
});
test('signed root administration can update all LOC Scope relations',async()=>{
  const db=registry([{id:'admin',email:'owner@example.test',
    manage_role:'admin',active:true}]);
  for(const table of ['manage','loc','lrunes_anchor']){
    await authorizeCrossEngineQuery(db,query(table,'update'),identity);
  }
});
test('cross-engine ACL has no RPC or raw SQL bypass',async()=>{
  await assert.rejects(authorizeCrossEngineQuery(registry([]),{
    kind:'rpc',schema:'silver',name:'management_write'},identity),/Unsupported cross-engine/);
});
