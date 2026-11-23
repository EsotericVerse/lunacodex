import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeLiveTarget,runtimeTargetId,registryRelationForEngine}
  from '../app/loc/providers/live-database-target.mjs';
import {normalizeSqlDriverAuthentication,sqlAuthNeedsUserPassword}
  from '../app/loc/providers/sql-driver-auth.mjs';
import {createKyselyDialect} from '../modules/loc/dialect/index.mjs';

const profile=engine=>({
  engine,host:'database.example.org',port:engine==='mysql'?3307:
    engine==='mssql'?1434:5433,database:'loc_docs',
  username:'reader',password:'password!+%/abc',table_name:'articles',
  field_map:{uid:'article_id',content:'body'},
});

test('trusted external SQL profiles preserve credentials and engine identity',()=>{
  for(const engine of ['postgres','mysql','mssql']){
    const {target,profile:checked}=normalizeLiveTarget('archive_one',profile(engine));
    assert.equal(target.engine,engine);
    assert.equal(target.connection_alias,'archive_one');
    assert.equal(target.connection_mode,'direct');
    assert.deepEqual(target.field_map,{uid:'article_id',content:'body'});
    assert.equal(checked.engine,engine);
    assert.equal(checked.tls,true);
    assert.equal(new URL(checked.url).protocol,engine+':');
    assert.equal(decodeURIComponent(new URL(checked.url).username),'reader');
    assert.equal(decodeURIComponent(new URL(checked.url).password),'password!+%/abc');
  }
});

test('MySQL database namespace is not silently replaced by PostgreSQL schema',()=>{
  const x=normalizeLiveTarget('archive_mysql',{
    ...profile('mysql'),schema_name:'loc_docs'
  });
  assert.ok(!Object.hasOwn(x.target,'schema_name'));
  assert.throws(()=>normalizeLiveTarget('archive_mysql',{
    ...profile('mysql'),schema_name:'other_database'
  }),/namespace must equal/);
});

test('MSSQL defaults to dbo; PostgreSQL keeps silver as separate schema',()=>{
  const sqlserver=normalizeLiveTarget('archive_sqlserver',profile('mssql'));
  assert.equal(sqlserver.target.schema_name,'dbo');
  const pg=normalizeLiveTarget('archive_pg',profile('postgres'));
  assert.equal(pg.target.schema_name,'silver');
  const scoped=normalizeLiveTarget('archive_sqlserver',{
    ...profile('mssql'),schema_name:'archive'
  });
  assert.equal(scoped.target.schema_name,'archive');
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

test('official Kysely dialect factory still requires trusted external drivers',()=>{
  assert.throws(()=>createKyselyDialect('mysql',{}),
    /Missing Kysely mysql dialect configuration: pool/);
  assert.throws(()=>createKyselyDialect('mssql',{}),
    /Missing Kysely mssql dialect configuration: tarn,tedious/);
  assert.equal(createKyselyDialect('mysql',{pool:{}}).constructor.name,'MysqlDialect');
  assert.equal(createKyselyDialect('mssql',{tarn:{},tedious:{}}).constructor.name,'MssqlDialect');
});
