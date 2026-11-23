import test from 'node:test';
import assert from 'node:assert/strict';
import {assertCrossEnginePublicRead,authorizeCrossEngineQuery,
  CROSS_ENGINE_PUBLIC_READ_TABLES} from '../app/loc/providers/sql-engine-ports.mjs';

const read=(schema,table)=>({
  kind:'query',operation:'select',schema,table,columns:['uid']
});

test('cross-engine anonymous reads cannot expose the private api.manage authority registry',async()=>{
  assert.throws(()=>assertCrossEnginePublicRead(read('api','manage')),
    error=>error?.httpStatus===403);
  await assert.rejects(authorizeCrossEngineQuery(null,read('api','manage'),
    {role:'anon'}),error=>error?.httpStatus===403);
});

test('cross-engine anonymous reads cannot expose raw Scope configuration rows',()=>{
  for(const table of ['loc','lo3rwang','lrunes','family']){
    assert.throws(()=>assertCrossEnginePublicRead(read('silver',table)),
      error=>error?.httpStatus===403);
  }
});

test('cross-engine fixed reference and public Blocks stay readable',()=>{
  for(const table of [...CROSS_ENGINE_PUBLIC_READ_TABLES,
    'lo3rwang_blocks','lrunes_blocks']){
    assert.deepEqual(assertCrossEnginePublicRead(read('silver',table)),
      {publicOnly:false});
  }
  assert.throws(()=>assertCrossEnginePublicRead(read('silver','loc_blocks')),
    error=>error?.httpStatus===403);
});

test('cross-engine Galaxy and Anchor remain published-only for anonymous reads',()=>{
  for(const table of ['lo3rwang_galaxy','lrunes_anchor']){
    assert.deepEqual(assertCrossEnginePublicRead(read('silver',table)),
      {publicOnly:true});
  }
  assert.throws(()=>assertCrossEnginePublicRead({
    ...read('silver','lo3rwang_galaxy'),operation:'update'
  }),error=>error?.httpStatus===403);
});
