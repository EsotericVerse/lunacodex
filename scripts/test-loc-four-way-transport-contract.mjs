import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
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

test('static app composition defers a missing Gateway error until an actual SQL read',async()=>{
  const source=readFileSync(new URL('../app/loc/db-client.mjs',import.meta.url),'utf8');
  assert.match(source,/createConfiguredAdapter\(\{allowUnconfigured:true\}\)/);
  let requests=0;
  const identity={auth:{},getAccessToken:async()=> 'native.signed.token'};
  const adapter=createConfiguredAdapter({gatewayUrl:'',allowUnconfigured:true,
    accountAdapter:identity,fetchImpl:async()=>{requests++;throw Error('Must not fetch');}});
  assert.equal(adapter.publicClient.role,'anon');
  await assert.rejects(
    adapter.publicClient.schema('silver').from('example_galaxy').select('uid').limit(1),
    /LOC SQL Gateway is not configured/);
  assert.equal(requests,0,'missing SQL Gateway cannot trigger any fallback request');
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
  assert.equal(adapter.auth,identity.auth);
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

test('database selection is a LOC Auth operation and never a website redeploy',()=>{
  const gateway=readFileSync(new URL('../app/loc/gateway/sql-handler.ts',import.meta.url),'utf8');
  const authority=readFileSync(new URL('../workers/loc-authority/index.mjs',import.meta.url),'utf8');
  assert.match(gateway,/Database selection is managed by LOC Auth/);
  assert.match(gateway,/\/v1\/databases\/selection/);
  assert.match(authority,/url\.pathname==='\/v1\/databases\/selection'/);
  assert.doesNotMatch(gateway,/update source and redeploy/);
});

test('anonymous Galaxy full-article projections respect list=false across SQL dialects',()=>{
  const runtime=readFileSync(new URL('../app/loc/providers/kysely-runtime.mjs',import.meta.url),'utf8');
  const start=runtime.indexOf('function publishedOnly(');
  const end=runtime.indexOf('\nfunction sameKeys(',start);
  assert.ok(start>0&&end>start,'Kysely public-read filter must exist');
  const section=runtime.slice(start,end).replace(/^export /gm,'');
  const compile=new Function('validateQuery','databaseTable','applyOrFilters','applyFilters',
    'PRIVATE_SITES',section+'\nreturn buildKyselySelectQuery;')(
    input=>({...input,filters:[],orFilters:[],orders:[],limit:1,offset:0}),
    req=>req.schema+'.'+req.table,q=>q,q=>q,[]);
  for(const engine of ['postgres','mysql','mssql']){
    for(const columns of [['title'],['uid','title'],['content'],['*']]){
      const filters=[];
      const query={where(...args){filters.push(args);return this;},
        orderBy(){return this;},limit(){return this;},offset(){return this;}};
      const trx={selectFrom:()=>({select:()=>query})};
      compile(trx,{kind:'query',schema:'silver',table:'lo3rwang_galaxy',
        operation:'select',columns},{dialect:engine,publicOnly:true});
      assert.ok(filters.some(parts=>parts[0]==='search'&&parts[2]===true));
      assert.equal(filters.some(parts=>parts[0]==='list'&&parts[2]===true),
        columns.includes('content')||columns.includes('*'),
        engine+' / '+columns.join(','));
    }
  }
});
