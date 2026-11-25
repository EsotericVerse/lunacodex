import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeLiveTarget,runtimeTargetId,registryRelationForEngine}
  from '../app/loc/providers/live-database-target.mjs';
import {normalizeSqlDriverAuthentication,sqlAuthNeedsUserPassword}
  from '../app/loc/providers/sql-driver-auth.mjs';
import {getSqlType,SQL_TYPES} from '../modules/loc/dialect/index.mjs';
import {db_connection,bindLocRequestAbort}
  from '../app/loc/mcp/native-kysely.mjs';

const profile=engine=>({
  engine,host:'database.example.org',port:engine==='mysql'?3307:
    engine==='mssql'?1434:5433,database:'loc_docs',
  username:'reader',password:'password!+%/abc',table_name:'articles',
  field_map:{uid:'article_id',content:'body'},
});

test('all external SQL profiles are fail-closed for unsupported authentication and credentials',()=>{
  for(const engine of ['postgres','mysql','mssql']){
    assert.deepEqual(normalizeSqlDriverAuthentication(engine),{type:'default'});
    assert.equal(sqlAuthNeedsUserPassword({type:'default'}),true);
    assert.throws(()=>normalizeSqlDriverAuthentication(engine,{type:'integrated'}),
      /Unsupported SQL driver authentication/);
    assert.throws(()=>normalizeSqlDriverAuthentication(engine,{type:'default',passThrough:true}),
      /Unexpected SQL driver authentication field/);
    assert.throws(()=>normalizeLiveTarget('archive_one',{
      ...profile(engine),password:''
    }),/incomplete/);
    assert.throws(()=>normalizeLiveTarget('archive_one',{
      ...profile(engine),port:0
    }),/incomplete/);
  }
  assert.throws(()=>normalizeLiveTarget('archive_one',profile('sqlite')),
    /Unsupported runtime SQL engine/);
});

test('a database target claim selects no user-provided SQL URL or control registry',()=>{
  assert.equal(runtimeTargetId({db_target:'archive_sqlserver'}),'archive_sqlserver');
  assert.equal(runtimeTargetId({}),null);
  assert.throws(()=>runtimeTargetId({db_target:'../../api'}),/Invalid/);
  assert.equal(registryRelationForEngine('postgres'),'api.manage');
  for(const engine of ['mysql','mssql']){
    assert.throws(()=>registryRelationForEngine(engine),/Unsupported main/);
  }
});

test('verified alias is mandatory to construct an external Kysely connection',async()=>{
  await assert.rejects(db_connection({},'archive_mysql'),/not configured/);
  await assert.rejects(db_connection({},'archive_mysql',{
    trustedTarget:profile('mysql')
  }),/not configured/);
  await assert.rejects(db_connection({},'loc-main',{
    trustedTarget:profile('mysql'),trustedDialectConfig:{pool:{}}
  }),/control database cannot be replaced/);
  await assert.rejects(db_connection({},'loc-main',{
    probeTicket:'probe'
  }),/Manual probe/);
});

test('request abort supports an external Kysely port without a PG pool',async()=>{
  const controller=new AbortController();
  let called=0;
  const release=bindLocRequestAbort({abort:async()=>{called++;}},controller.signal);
  controller.abort();
  assert.equal(called,1);
  release();
  controller.abort();
  assert.equal(called,1);
});

test('LOC selects only the explicitly requested SQL Type',()=>{
  assert.deepEqual(SQL_TYPES.map(type=>type.id),['postgres','mysql','mssql']);
  for(const engine of ['postgres','mysql','mssql'])assert.equal(getSqlType(engine).id,engine);
  for(const engine of [undefined,'','neon','azure']){
    assert.throws(()=>getSqlType(engine),/Unsupported Kysely SQL dialect/);
  }
});

test('provider name never chooses SQL Type: Cloud SQL profiles can independently use PostgreSQL, MySQL or T-SQL',()=>{
  for(const engine of ['postgres','mysql','mssql']){
    const selected=normalizeLiveTarget('gcloud_'+engine,{
      ...profile(engine),provider:'google-cloud-sql',
      host:'sql.example.org',
      ...(engine==='postgres'?{schema_name:'analytics'}:{})
    });
    assert.equal(selected.target.engine,engine);
    assert.equal(selected.profile.engine,engine);
    assert.equal(new URL(selected.profile.url).hostname,'sql.example.org');
    assert.equal(selected.target.connection_alias,'gcloud_'+engine);
  }
  assert.throws(()=>normalizeLiveTarget('gcloud_unknown',{
    ...profile('postgres'),engine:'',provider:'google-cloud-sql'
  }),/Unsupported runtime SQL engine/);
});
