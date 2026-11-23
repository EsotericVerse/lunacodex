import test from 'node:test';
import assert from 'node:assert/strict';
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
  assert.ok(!ms.operations.includes('upsert'));
  assert.deepEqual(pg.managedOperations,
    ['insert','upsert','update','delete','update_batch','append_media_link']);
  for(const port of [my,ms]){
    assert.deepEqual(port.managedOperations,
      ['insert','update','delete','update_batch']);
  }
});
