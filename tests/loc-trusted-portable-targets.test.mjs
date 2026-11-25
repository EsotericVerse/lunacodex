import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeLiveTarget,runtimeTargetId,registryRelationForEngine}
  from '../app/loc/providers/live-database-target.mjs';
import {normalizeSqlDriverAuthentication,sqlAuthNeedsUserPassword}
  from '../app/loc/providers/sql-driver-auth.mjs';
import {getSqlType} from '../modules/loc/dialect/index.mjs';
import {db_connection}
  from '../app/loc/mcp/native-kysely.mjs';

const profile=(engine='postgres')=>({
  engine,host:'database.example.org',port:5433,database:'loc_docs',
  username:'reader',password:'password!+%/abc',table_name:'articles',
  field_map:{uid:'article_id',content:'body'},
});

test('PostgreSQL profiles reject invalid authentication and credentials',()=>{
  const engine='postgres';
  assert.deepEqual(normalizeSqlDriverAuthentication(engine),{type:'default'});
  assert.equal(sqlAuthNeedsUserPassword({type:'default'}),true);
  assert.throws(()=>normalizeSqlDriverAuthentication(engine,{type:'integrated'}),/Unsupported SQL driver authentication/);
  assert.throws(()=>normalizeSqlDriverAuthentication(engine,{type:'default',passThrough:true}),/Unexpected SQL driver authentication field/);
  assert.throws(()=>normalizeLiveTarget('archive_one',{...profile(),password:''}),/incomplete/);
  assert.throws(()=>normalizeLiveTarget('archive_one',{...profile(),port:0}),/incomplete/);
});

test('a database target claim selects no user-provided SQL URL or control registry',()=>{
  assert.equal(runtimeTargetId({db_target:'archive_pg'}),'archive_pg');
  assert.equal(runtimeTargetId({}),null);
  assert.throws(()=>runtimeTargetId({db_target:'../../api'}),/Invalid/);
  assert.equal(registryRelationForEngine('postgres'),'api.manage');
});

test('verified alias is mandatory to construct an external Kysely connection',async()=>{
  await assert.rejects(db_connection({},'archive_pg'),/not configured/);
  await assert.rejects(db_connection({},'archive_pg',{
    trustedTarget:profile()
  }),/not configured/);
  await assert.rejects(db_connection({},'loc-main',{
    trustedTarget:profile(),trustedDialectConfig:{pool:{}}
  }),/control database cannot be replaced/);
  await assert.rejects(db_connection({},'loc-main',{
    probeTicket:'probe'
  }),/Manual probe/);
});

test('LOC selects PostgreSQL by explicit SQL Type, not provider',()=>{
  assert.equal(getSqlType('postgres').id,'postgres');
  for(const engine of [undefined,'','neon','azure'])assert.throws(()=>getSqlType(engine),/Unsupported Kysely SQL dialect/);
  const selected=normalizeLiveTarget('archive_pg',{...profile(),provider:'google-cloud-sql'});
  assert.equal(selected.target.engine,'postgres');
  assert.equal(selected.profile.engine,'postgres');
});
