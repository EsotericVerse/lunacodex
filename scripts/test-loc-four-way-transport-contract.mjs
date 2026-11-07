import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createConfiguredAdapter} from '../app/loc/providers/configured.mjs';
import {DATABASE_ACCESS_LIST} from '../app/loc/providers/access.js';
import {resolveDatabaseRouting} from '../app/loc/providers/routing-config.mjs';
import {normalizeDatabaseTarget} from '../app/loc/providers/selected-database-target.mjs';
import {resolveSqlExecutionPort} from '../app/loc/providers/sql-engine-ports.mjs';

const fetchImpl=async()=>Response.json({data:[],count:0});

test('LOC browser composition does not construct a SQL Gateway',()=>{
 const configured=readFileSync(new URL('../app/loc/providers/configured.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(configured,/createLocGatewayAdapter|NEXT_PUBLIC_LOC_SQL_GATEWAY_URL/);
 const identity={auth:{},getAccessToken:async()=>''};
 const adapter=createConfiguredAdapter({
   accountAdapter:identity,
   url:'https://read.example.net/rest/v1',publishableKey:'public-read-only',
   fetchImpl
 });
 assert.equal(adapter.auth,identity.auth);
 assert.equal(adapter.publicClient.role,'anon');
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

test('database selection stays with LOC Auth and never triggers deployment',()=>{
 const authority=readFileSync(new URL('../workers/loc-authority/index.mjs',import.meta.url),'utf8');
 assert.match(authority,/url\.pathname==='\/v1\/databases\/selection'/);
 const browser=readFileSync(new URL('../app/loc/auth/loc-browser.mjs',import.meta.url),'utf8');
 assert.match(browser,/createLocAccountAdapter/);
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
