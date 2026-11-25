import test from 'node:test';
import assert from 'node:assert/strict';
import {assertCrossEnginePublicRead,authorizeCrossEngineQuery}
  from '../app/loc/providers/sql-engine-ports.mjs';
import {Kysely,PostgresDialect} from 'kysely';
import {buildKyselyUpsertQuery}
  from '../app/loc/providers/kysely-runtime.mjs';

const postgres=new Kysely({dialect:new PostgresDialect({pool:{
  connect:async()=>{throw Error('compile-only: no database connection');}
}})});
const req={schema:'silver',table:'lo3rwang_galaxy',
  values:[{uid:'AAAA0001',title:'one'},{uid:'BBBB0002',title:'two'}],
  onConflict:['uid']};

test('PostgreSQL UPSERT continues to use row-specific EXCLUDED values',()=>{
  const compiled=buildKyselyUpsertQuery(postgres,req,'postgres').compile();
  assert.match(compiled.sql,/on conflict/i);
  assert.match(compiled.sql,/excluded.*title/i);
  assert.equal(compiled.parameters.length,4);
});
{
const read=(schema,table)=>({
  kind:'query',operation:'select',schema,table,columns:['uid']
});

test('anonymous reads cannot expose the private api.manage authority registry',async()=>{
  assert.throws(()=>assertCrossEnginePublicRead(read('api','manage')),
    error=>error?.httpStatus===403);
  await assert.rejects(authorizeCrossEngineQuery(null,read('api','manage'),
    {role:'anon'}),error=>error?.httpStatus===403);
});

test('anonymous reads cannot expose raw Scope configuration rows',()=>{
  for(const table of ['loc','lo3rwang','lrunes','family']){
    assert.throws(()=>assertCrossEnginePublicRead(read('silver',table)),
      error=>error?.httpStatus===403);
  }
});

test('public SQL policy restricts Galaxy and Anchor to published rows and denies writes',()=>{
  for(const table of ['lo3rwang_galaxy','lrunes_anchor']){
    assert.deepEqual(assertCrossEnginePublicRead(read('silver',table)),{publicOnly:true});
  }
  assert.throws(()=>assertCrossEnginePublicRead({
    ...read('silver','lo3rwang_galaxy'),operation:'update'
  }),error=>error?.httpStatus===403);
});

}
