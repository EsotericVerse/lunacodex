import test from 'node:test';
import assert from 'node:assert/strict';
import {createConfiguredAdapter} from '../app/loc/providers/configured.mjs';
import {createKyselyEdgeClient} from '../app/loc/providers/kysely-edge.mjs';
import {DATABASE_ACCESS_LIST} from '../app/loc/providers/access.js';
import {resolveDatabaseRouting} from '../app/loc/providers/routing-config.mjs';
import {normalizeDatabaseTarget} from '../app/loc/providers/selected-database-target.mjs';
import {resolveSqlExecutionPort} from '../app/loc/providers/sql-engine-ports.mjs';

const fetchImpl=async()=>Response.json({data:[],count:0});

test('LOC SQL Gateway is mandatory; silent provider fallback is rejected',()=>{
  assert.throws(()=>createConfiguredAdapter({gatewayUrl:' ',fetchImpl}),
    /LOC SQL Gateway is not configured/);
  assert.throws(()=>createKyselyEdgeClient({gatewayUrl:'',role:'anon',fetch:fetchImpl}),
    /LOC SQL Gateway is not configured/);
});

test('public and delegated clients use a single explicit independent endpoint',()=>{
  const identity={auth:{},getAccessToken:async()=> 'native.signed.token'};
  const adapter=createConfiguredAdapter({
    authorityUrl:'https://auth.lo3rwang.cc',
    gatewayUrl:'https://sql.example.org/v1/sql',
    accountAdapter:identity,fetchImpl
  });
  assert.equal(adapter.realtimeClient,null);
  assert.equal(adapter.publicClient.role,'anon');
  assert.equal(adapter.authClient.role,'authenticated');
  assert.equal(adapter.authClient.auth,identity.auth);
});

test('database control is an alias, not a hosting-vendor dependency',()=>{
  assert.equal(DATABASE_ACCESS_LIST.length,1);
  assert.equal(DATABASE_ACCESS_LIST[0].connection_alias,'loc_main');
  const route=resolveDatabaseRouting();
  assert.equal(route.provider,'custom');
  assert.equal(route.connectionAlias,'loc_main');
  assert.equal(normalizeDatabaseTarget({
    provider:'custom',engine:'mssql',connection_alias:'office_mssql'
  }).engine,'mssql');
  assert.throws(()=>normalizeDatabaseTarget({
    provider:'unknown',engine:'postgres',connection_alias:'office_pg'
  }),/not supported/);
  assert.equal(resolveSqlExecutionPort({engine:'postgres',provider:'custom'}).session,
    'external-acl');
});
