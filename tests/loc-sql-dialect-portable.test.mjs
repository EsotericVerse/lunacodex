import test from 'node:test';
import assert from 'node:assert/strict';
import {assertCrossEnginePublicRead,authorizeCrossEngineQuery,
  CROSS_ENGINE_PUBLIC_READ_TABLES,executeCrossEngineManagedWrite}
  from '../app/loc/providers/sql-engine-ports.mjs';
import {verifyModeledSqlFields} from '../packages/zenstack/model-column-guard.mjs';
import {Kysely,PostgresDialect,MysqlDialect,MssqlDialect} from 'kysely';
import {buildKyselyUpsertQuery,buildKyselyMutationQuery}
  from '../app/loc/providers/kysely-runtime.mjs';
import {getSqlRuntimeCapabilities}
  from '../app/loc/providers/sql-engine-ports.mjs';

const postgres=new Kysely({dialect:new PostgresDialect({pool:{
  connect:async()=>{throw Error('compile-only: no database connection');}
}})});
const mysql=new Kysely({dialect:new MysqlDialect({pool:{}})});
// Use SQL Server's real compiler/adapter, with no actual driver or credentials.
const compiler=new MssqlDialect({tarn:{},tedious:{}});
const mssql=new Kysely({dialect:{
  createDriver:()=>({init:async()=>{},acquireConnection:async()=>{
    throw Error('compile-only: no SQL Server connection');
  },beginTransaction:async()=>{},commitTransaction:async()=>{},
    rollbackTransaction:async()=>{},releaseConnection:async()=>{},destroy:async()=>{}}),
  createAdapter:()=>compiler.createAdapter(),
  createIntrospector:db=>compiler.createIntrospector(db),
  createQueryCompiler:()=>compiler.createQueryCompiler()
}});
const req={schema:'silver',table:'lo3rwang_galaxy',
  values:[{uid:'AAAA0001',title:'one'},{uid:'BBBB0002',title:'two'}],
  onConflict:['uid']};

test('PostgreSQL UPSERT continues to use row-specific EXCLUDED values',()=>{
  const compiled=buildKyselyUpsertQuery(postgres,req,'postgres').compile();
  assert.match(compiled.sql,/on conflict/i);
  assert.match(compiled.sql,/excluded.*title/i);
  assert.equal(compiled.parameters.length,4);
});
test('MySQL UPSERT uses VALUES of each incoming row and targets a modeled PK',()=>{
  const compiled=buildKyselyUpsertQuery(mysql,req,'mysql').compile();
  assert.match(compiled.sql,/on duplicate key update/i);
  assert.match(compiled.sql,/values\(`title`\)/i);
  assert.doesNotMatch(compiled.sql,/on conflict/i);
  assert.deepEqual(compiled.parameters,
    ['AAAA0001','one','BBBB0002','two']);
});
test('MySQL rejects ambiguous conflict keys and broad INSERT IGNORE',()=>{
  assert.throws(()=>buildKyselyUpsertQuery(mysql,{
    ...req,onConflict:['site_id']
  },'mysql'),/exact modeled primary key/);
  assert.throws(()=>buildKyselyUpsertQuery(mysql,{
    ...req,ignoreDuplicates:true
  },'mysql'),/conflict-ignore/);
  assert.throws(()=>buildKyselyUpsertQuery(mssql,req,'mssql'),
    /not implemented/);
});
test('SQL Server uses OUTPUT inserted for INSERT and UPDATE',()=>{
  const insertion=buildKyselyMutationQuery(mssql,{
    kind:'query',schema:'silver',table:'lo3rwang_galaxy',
    operation:'insert',values:{uid:'AAAA0001',title:'one'},
    returning:true,columns:['uid','title']
  },{dialect:'mssql',namespace:'silver'}).query.compile();
  assert.match(insertion.sql,/output\s+.*inserted.*uid/i);
  assert.match(insertion.sql,/inserted.*title/i);
  const updating=buildKyselyMutationQuery(mssql,{
    kind:'query',schema:'silver',table:'lo3rwang_galaxy',
    operation:'update',values:{title:'updated'},
    filters:[{column:'uid',operator:'eq',value:'AAAA0001'}],
    returning:true,columns:['uid']
  },{dialect:'mssql',namespace:'silver'}).query.compile();
  assert.match(updating.sql,/output\s+.*inserted.*uid/i);
});
test('SQL Server uses OUTPUT deleted for DELETE',()=>{
  const compiled=buildKyselyMutationQuery(mssql,{
    kind:'query',schema:'silver',table:'lo3rwang_galaxy',
    operation:'delete',filters:[{column:'uid',operator:'eq',value:'AAAA0001'}],
    returning:true,columns:['uid']
  },{dialect:'mssql',namespace:'silver'}).query.compile();
  assert.match(compiled.sql,/output\s+.*deleted.*uid/i);
});
test('MySQL refuses unsupported RETURNING rather than issuing invalid SQL',()=>{
  assert.throws(()=>buildKyselyMutationQuery(mysql,{
    kind:'query',schema:'silver',table:'lo3rwang_galaxy',
    operation:'insert',values:{uid:'AAAA0001',title:'one'},
    returning:true,columns:['uid']
  },{dialect:'mysql',namespace:''}),/no equivalent native.*RETURNING/);
});
test('Capability report separates dialect features from actual production connection',()=>{
  const pg=getSqlRuntimeCapabilities('postgres');
  const my=getSqlRuntimeCapabilities('mysql');
  const ms=getSqlRuntimeCapabilities('mssql');
  assert.equal(pg.nativeConnection,true);
  assert.equal(my.nativeConnection,false);
  assert.equal(ms.nativeConnection,false);
  assert.equal(my.returning,false);
  assert.equal(ms.returning,true);
  assert.ok(my.operations.includes('upsert'));
  assert.ok(ms.operations.includes('upsert'));
  assert.deepEqual(pg.managedOperations,
    ['insert','upsert','update','delete','update_batch','append_media_link']);
  for(const port of [my,ms]){
    assert.deepEqual(port.managedOperations,
      ['insert','upsert','update','delete','update_batch']);
  }
});

{
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

test('portable managed SQL rejects unmodeled relation before calling the driver',async()=>{
  const db=new Proxy({},{
    get(){throw new Error('Database must not be accessed');}
  });
  await assert.rejects(executeCrossEngineManagedWrite(db,{payload:{
    p_table:'silver.unknown_data',p_operation:'insert',
    p_rows:[{uid:'AAAA0001'}]
  }},{engine:'mssql',role:'authenticated',claims:{grants:[]}}),
  /not modeled/);
});

test('portable modeled writes refuse unknown SQL columns',()=>{
  assert.equal(verifyModeledSqlFields({
    schema:'silver',table:'lo3rwang_galaxy',
    values:{uid:'AAAA0001',title:'known'}
  }),true);
  assert.throws(()=>verifyModeledSqlFields({
    schema:'silver',table:'lo3rwang_galaxy',
    values:{uid:'AAAA0001',nonexistent_field:'ignored'}
  }),/Column is not defined in the LOC ZModel/);
  assert.throws(()=>verifyModeledSqlFields({
    schema:'silver',table:'lo3rwang_anchor',
    filters:[{column:'unknown_filter',operator:'eq',value:1}]
  }),/Column is not defined in the LOC ZModel/);
});
}
