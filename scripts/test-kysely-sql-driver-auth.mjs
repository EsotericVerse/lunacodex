import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSqlDriverAuthentication,publicSqlDriverAuthentication,
 sqlAuthNeedsUserPassword} from '../app/loc/providers/sql-driver-auth.mjs';

test('PostgreSQL is the sole installed driver and requires a database password',()=>{
 const config=normalizeSqlDriverAuthentication('postgres');
 assert.deepEqual(config,{type:'default'});
 assert.equal(sqlAuthNeedsUserPassword(config),true);
 assert.deepEqual(publicSqlDriverAuthentication(config),{type:'default'});
});

test('disabled MySQL, MSSQL and Azure driver authentication fail closed',()=>{
 for(const engine of ['mysql','mssql']){
  assert.throws(()=>normalizeSqlDriverAuthentication(engine),
   /Unsupported SQL driver authentication for engine/);
 }
 for(const auth of [{type:'ntlm',domain:'corp'},
  {type:'azure-active-directory-access-token',token:'abc'},
  {type:'ldap-simple'}]){
  assert.throws(()=>normalizeSqlDriverAuthentication('postgres',auth),/Unsupported/);
 }
});

test('unexpected secrets are never accepted as PostgreSQL auth metadata',()=>{
 assert.throws(()=>normalizeSqlDriverAuthentication('postgres',null),/Invalid/);
 assert.throws(()=>normalizeSqlDriverAuthentication('postgres',{type:'default',token:'token'}),/Unexpected/);
 assert.throws(()=>normalizeSqlDriverAuthentication('postgres',{type:'default',password:'hidden'}),/Unexpected/);
 assert.deepEqual(publicSqlDriverAuthentication({type:'default',password:'hidden'}),{type:'default'});
});
