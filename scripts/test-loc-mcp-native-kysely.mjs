import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {directMcpKysely,mcpDatabaseConfiguration} from '../app/loc/mcp/native-kysely.mjs';

const SERVICE='backend-only-secret-with-at-least-32-bytes';
const getEnv=()=>({LOC_DB_PROFILE_SERVICE_TOKEN:SERVICE});
const mockProfile=(engine='postgres')=>({
 engine,host:'db.example.net',port:engine==='mysql'?3306:engine==='mssql'?1433:5432,
 database:'loc',username:'reader',password:'test-only-password',
 schema_name:engine==='mysql'?'':engine==='mssql'?'dbo':'silver'
});

test('the LOC service token is configuration only, never proof of write success',()=>{
 const empty=mcpDatabaseConfiguration({});
 assert.deepEqual(empty,{publicReadConfigured:false,privateReadConfigured:false,
  privateWriteConfigured:false,verification:'configuration-only'});
 assert.deepEqual(mcpDatabaseConfiguration({
  LOC_DB_CONNECTIONS_JSON:'untrusted-local-override'}),empty);
 const service=mcpDatabaseConfiguration(getEnv());
 assert.equal(service.privateReadConfigured,true);
 assert.equal(service.privateWriteConfigured,false);
 assert.equal(service.publicReadConfigured,false);
 assert.equal(JSON.stringify(service).includes(SERVICE),false);
});

test('signed primary aliases share one Kysely dialect without a second profile path',async()=>{
 const env=getEnv(),urls=[];
 const fetchImpl=async url=>{urls.push(url);return Response.json(mockProfile());};
 const first=await directMcpKysely(env,'',{fetchImpl});
 const second=await directMcpKysely(env,'loc-main',{fetchImpl});
 assert.strictEqual(first,second);
 assert.equal(first.engine,'postgres');
 assert.equal(first.namespace,'silver');
 assert.equal(typeof first.db.selectFrom,'function');
 assert.equal(typeof first.dialect.createDriver,'function');
 assert.ok(urls.every(url=>url.endsWith('/v1/internal/database/primary')));
 await first.db.destroy();
});

test('missing or invalid Authority profile access fails closed',async()=>{
 await assert.rejects(directMcpKysely({}),/Trusted LOC profile service is required/);
 await assert.rejects(directMcpKysely(getEnv(),'bad/alias'),/Invalid verified database alias/);
 await assert.rejects(directMcpKysely(getEnv(),'external',{
  fetchImpl:async()=>Response.json({code:'DATABASE_TARGET_MISSING'},{status:503})
 }),error=>error.code==='DATABASE_TARGET_MISSING');
});

test('Kysely compiles PostgreSQL and rejects absent runtime dialects',async()=>{
 const selected=await directMcpKysely(getEnv(),'target_postgres',{
  fetchImpl:async()=>Response.json(mockProfile('postgres'))
 });
 assert.equal(selected.engine,'postgres');
 assert.equal(selected.namespace,'silver');
 assert.match(selected.db.selectFrom('silver.galaxy').select('uid').limit(2).compile().sql,
  /"silver"\."galaxy"/);
 await selected.db.destroy();
 for(const engine of ['mysql','mssql'])
  await assert.rejects(directMcpKysely(getEnv(),'target_'+engine,{
   fetchImpl:async()=>Response.json(mockProfile(engine))
  }),/Unsupported runtime SQL engine/);
});
test('live Auth-selected profile is resolved only through trusted server secret',async()=>{
 const env={LOC_DB_PROFILE_SERVICE_TOKEN:'backend-only-secret-with-at-least-32-bytes'};
 const invoked=[];
 const fetchImpl=async(url,options)=>{
  invoked.push({url,options});
  return Response.json({engine:'postgres',host:'db.example.net',port:5432,database:'loc',
   username:'readonly',password:'sample-only-secret',
   schema_name:'silver',table_name:'existing_articles',field_map:{title:'headline'}});
 };
 const selected=await directMcpKysely(env,'office_postgres',{fetchImpl});
 assert.equal(selected.engine,'postgres');
 assert.equal(selected.tableName,'existing_articles');
 assert.deepEqual(selected.fieldMap,{title:'headline'});
 assert.equal(invoked.length,1);
 assert.match(invoked[0].url,/\/v1\/internal\/database\/office_postgres$/);
 assert.equal(invoked[0].options.headers['x-loc-service-token'],env.LOC_DB_PROFILE_SERVICE_TOKEN);
 await selected.db.destroy();
 await assert.rejects(directMcpKysely(env,'bad/alias',{fetchImpl}),/Invalid verified database alias/);
});
test('MCP Pages is a native business route, not a SQL Gateway',()=>{
 for(const route of ['functions/index.js','functions/mcp.js']){
  const source=readFileSync(new URL('../'+route,import.meta.url),'utf8');
  assert.match(source,/locDirectDatabase:\(verifiedAlias=''\)=>directMcpKysely\(bindings,verifiedAlias\)/);
  assert.doesNotMatch(source,/LOC_SQL_GATEWAY_URL|\/v1\/sql/);
 }
});

test('published server alias resolves to encrypted LOC Authority target with no duplicate Pages SQL password',async()=>{
 const env={LOC_DB_PROFILE_SERVICE_TOKEN:'backend-only-secret-with-at-least-32-bytes'};
 const observed=[];
 const fetchImpl=async(url,options)=>{
  observed.push({url,options});
  return Response.json({engine:'postgres',host:'db.example.org',port:5432,
   database:'loc',username:'loc_reader',password:'in-memory-test-only',
   schema_name:'silver'});
 };
 const selected=await directMcpKysely(env,'',{fetchImpl});
 assert.equal(selected.engine,'postgres');
 assert.equal(selected.namespace,'silver');
 assert.equal(observed.length,1);
 assert.match(observed[0].url,/\/v1\/internal\/database\/primary$/);
 assert.equal(observed[0].options.headers['x-loc-service-token'],env.LOC_DB_PROFILE_SERVICE_TOKEN);
 await selected.db.destroy();
});
test('Authority owns primary profile even when old environment JSON is supplied',async()=>{
 const env={LOC_DB_PROFILE_SERVICE_TOKEN:'trusted-service-token-over-32-characters',
  LOC_DB_CONNECTIONS_JSON:JSON.stringify({loc_main:{
   engine:'postgres',url:'postgresql://old:old@old.example.net:5432/loc'
  }})};
 const observed=[];
 const selected=await directMcpKysely(env,'',{fetchImpl:async(url)=>{
  observed.push(url);
  return Response.json({engine:'postgres',host:'verified.example.net',port:6543,
   database:'loc',username:'reader',password:'test-only-credential',
   schema_name:'silver'});
 }});
 assert.equal(observed.length,1);
 assert.ok(observed[0].endsWith('/v1/internal/database/primary'));
 assert.equal(selected.engine,'postgres');
 assert.equal(selected.namespace,'silver');
 await selected.db.destroy();
});

test('legacy loc_main alias resolves the current primary, not a phantom Authority target',async()=>{
 const env={LOC_DB_PROFILE_SERVICE_TOKEN:'backend-only-secret-with-at-least-32-bytes'};
 const calls=[];
 const selected=await directMcpKysely(env,'loc_main',{fetchImpl:async(url)=>{
  calls.push(url);
  return Response.json({engine:'postgres',host:'db.example.net',port:5432,
   database:'loc',username:'reader',password:'test-only-password',schema_name:'silver'});
 }});
 assert.equal(calls.length,1);
 assert.ok(calls[0].endsWith('/v1/internal/database/primary'));
 await selected.db.destroy();
});
test('Authority profile failures retain precise public-safe codes without SQL',async()=>{
 const env={LOC_DB_PROFILE_SERVICE_TOKEN:'backend-only-secret-with-at-least-32-bytes'};
 for(const [status,code] of [[503,'PRIMARY_TARGET_MISSING'],
   [503,'DATABASE_TARGET_MISSING'],[423,'SQL_VERIFICATION_REQUIRED']]){
  await assert.rejects(directMcpKysely(env,'',{
   fetchImpl:async()=>Response.json({error:'Recovery control unavailable',code},{status})
  }),error=>error.code===code&&!error.message.includes(env.LOC_DB_PROFILE_SERVICE_TOKEN));
 }
 await assert.rejects(directMcpKysely(env,'',{
   fetchImpl:async()=>Response.json({error:'Trusted LOC backend required'},{status:403})
 }),error=>error.code==='PROFILE_HTTP_403');
});
test('untrusted missing Authority target is refused; secret never appears in an exception',async()=>{
 const env={LOC_DB_PROFILE_SERVICE_TOKEN:'backend-only-secret-with-at-least-32-bytes'};
 await assert.rejects(directMcpKysely(env,'',{fetchImpl:async()=>new Response('Forbidden',{status:403})}),
  error=>/profile lookup refused \(403\)/.test(error.message)&&
    !error.message.includes(env.LOC_DB_PROFILE_SERVICE_TOKEN));
});

test('the fixed primary can use a server-only Cloudflare SQL secret through Kysely',async()=>{
 const env={LOC_DATABASE_URI:'postgresql://postgres.test:temporary@db.example.org:6543/postgres'};
 const urls=[];
 const fetchImpl=async url=>{urls.push(url);throw Error('Primary must not request the missing Authority profile')};
 const a=await directMcpKysely(env,'',{fetchImpl});
 const b=await directMcpKysely(env,'loc-main',{fetchImpl});
 const c=await directMcpKysely(env,'loc_main',{fetchImpl});
 assert.strictEqual(a,b);
 assert.strictEqual(a,c);
 assert.equal(a.engine,'postgres');
 assert.equal(a.namespace,'silver');
 assert.equal(a.tableName,'');
 assert.equal(urls.length,0);
 assert.match(a.db.selectFrom('silver.lo3rwang_galaxy').select('uid').limit(1).compile().sql,/"silver"\."lo3rwang_galaxy"/);
 assert.equal(mcpDatabaseConfiguration(env).privateReadConfigured,true);
 assert.equal(mcpDatabaseConfiguration(env).privateWriteConfigured,false);
 await a.db.destroy();
});
test('external database alias cannot use a Cloudflare primary connection secret',async()=>{
 const secret='postgresql://postgres.test:temporary@db.example.org:6543/postgres';
 const env={LOC_DATABASE_URI:secret,LOC_DB_PROFILE_SERVICE_TOKEN:SERVICE};
 const requested=[];
 const target=await directMcpKysely(env,'office_postgres',{fetchImpl:async url=>{
  requested.push(url);
  return Response.json(mockProfile('postgres'));
 }});
 assert.equal(target.engine,'postgres');
 assert.ok(requested[0].endsWith('/v1/internal/database/office_postgres'));
 await target.db.destroy();
});
test('portless Neon PostgreSQL URI is accepted with the standard 5432 driver default',async()=>{
 const env={LOC_DATABASE_URI:'postgresql://reader:sample-only@neon.example.org/neondb?sslmode=require'};
 const selected=await directMcpKysely(env,'loc-main',{fetchImpl:async()=>{
  throw Error('Main must not request Authority profile');
 }});
 assert.equal(selected.engine,'postgres');
 assert.equal(selected.namespace,'silver');
 assert.match(selected.db.selectFrom('silver.lo3rwang_galaxy').select('uid').compile().sql,
  /"silver"."lo3rwang_galaxy"/);
 await selected.db.destroy();
});
test('malformed Cloudflare primary URL is refused before SQL or Authority request',async()=>{
 const env={LOC_DATABASE_URI:'postgresql://postgres:secret@/postgres'};
 await assert.rejects(directMcpKysely(env,'',{fetchImpl:async()=>{
  throw Error('Must not call HTTP');
 }}),err=>err.code==='BACKEND_UNAVAILABLE'&&!err.message.includes('secret'));
});
 
test('LOC business SQL connection does not call Neon or Supabase platform REST APIs',()=>{
 const source=readFileSync(new URL('../app/loc/mcp/native-kysely.mjs',import.meta.url),'utf8');
 assert.equal(source.includes('api.supabase.com'),false);
 assert.equal(source.includes('console.neon.tech/api'),false);
 assert.equal(source.includes('provider_oauth'),false);
 assert.ok(source.includes('PostgresDialect'));
 assert.ok(source.includes('LOC_DATABASE_URI'));
});
