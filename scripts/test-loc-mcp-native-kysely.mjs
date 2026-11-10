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

test('Kysely compiles Postgres, MySQL and SQL Server via one Authority profile',async()=>{
 for(const engine of ['postgres','mysql','mssql']){
  const env=getEnv();
  const selected=await directMcpKysely(env,'target_'+engine,{
   fetchImpl:async()=>Response.json(mockProfile(engine))
  });
  assert.equal(selected.engine,engine);
  const namespace=engine==='mysql'?'':engine==='mssql'?'dbo':'silver';
  assert.equal(selected.namespace,namespace);
  const sql=selected.db.selectFrom(namespace?namespace+'.galaxy':'galaxy')
   .select('uid').limit(2).compile().sql;
  if(engine==='postgres')assert.match(sql,/"silver"\."galaxy"/);
  if(engine==='mysql')assert.match(sql,/\x60galaxy\x60/);
  if(engine==='mssql')assert.match(sql,/"dbo"\."galaxy"/);
  await selected.db.destroy();
 }
});
test('live Auth-selected profile is resolved only through trusted server secret',async()=>{
 const env={LOC_DB_PROFILE_SERVICE_TOKEN:'backend-only-secret-with-at-least-32-bytes'};
 const invoked=[];
 const fetchImpl=async(url,options)=>{
  invoked.push({url,options});
  return Response.json({engine:'mysql',host:'db.example.net',port:3306,database:'loc',
   username:'readonly',password:'sample-only-secret',
   schema_name:'',table_name:'existing_articles',field_map:{title:'headline'}});
 };
 const selected=await directMcpKysely(env,'office_mysql',{fetchImpl});
 assert.equal(selected.engine,'mysql');
 assert.equal(selected.tableName,'existing_articles');
 assert.deepEqual(selected.fieldMap,{title:'headline'});
 assert.equal(invoked.length,1);
 assert.match(invoked[0].url,/\/v1\/internal\/database\/office_mysql$/);
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
 const env={LOC_DATABASE_URL:'postgresql://postgres.test:temporary@db.example.org:6543/postgres'};
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
 const env={LOC_DATABASE_URL:secret,LOC_DB_PROFILE_SERVICE_TOKEN:SERVICE};
 const requested=[];
 const target=await directMcpKysely(env,'office_mysql',{fetchImpl:async url=>{
  requested.push(url);
  return Response.json(mockProfile('mysql'));
 }});
 assert.equal(target.engine,'mysql');
 assert.ok(requested[0].endsWith('/v1/internal/database/office_mysql'));
 await target.db.destroy();
});
test('malformed Cloudflare primary URL is refused before SQL or Authority request',async()=>{
 const env={LOC_DATABASE_URL:'postgresql://postgres:secret@db.example.org/postgres'};
 await assert.rejects(directMcpKysely(env,'',{fetchImpl:async()=>{
  throw Error('Must not call HTTP');
 }}),err=>err.code==='BACKEND_UNAVAILABLE'&&!err.message.includes('secret'));
});

test('one LOC caller can select two provider APIs through db_connection',async()=>{
 const key='authorized-provider-test-token';
 const profiles={
  supabase_db:{engine:'postgres',db_type:'supabase',
   project_id:'abcdefghijklmnopqrst',provider_oauth:key,
   host:'db.supabase.example',port:6543,database:'postgres',
   username:'reader',password:'placeholder-only',schema_name:'silver'},
  neon_db:{engine:'postgres',db_type:'neon',
   project_id:'mellow-river-12345678',provider_oauth:key,
   host:'db.neon.example',port:5432,database:'neondb',
   username:'reader',password:'placeholder-only',schema_name:'silver'}
 };
 const calls=[];
 const fetchImpl=async(url,options)=>{
  calls.push({url,options});
  if(url.endsWith('/v1/internal/database/supabase_db'))
   return Response.json(profiles.supabase_db);
  if(url.endsWith('/v1/internal/database/neon_db'))
   return Response.json(profiles.neon_db);
  if(url==='https://api.supabase.com/v1/projects')
   return Response.json([{id:profiles.supabase_db.project_id}]);
  if(url==='https://console.neon.tech/api/v2/projects/'+profiles.neon_db.project_id)
   return Response.json({project:{id:profiles.neon_db.project_id}});
  throw Error('Unexpected provider API call');
 };
 const env={LOC_DB_PROFILE_SERVICE_TOKEN:'test-signed-profile-service-secret-long-enough'};
 const probe='00000000-0000-4000-8000-000000000001';
 const supabase=await directMcpKysely(env,'supabase_db',{fetchImpl,probeTicket:probe});
 const neon=await directMcpKysely(env,'neon_db',{fetchImpl,
  probeTicket:'00000000-0000-4000-8000-000000000002'});
 assert.equal(supabase.engine,'postgres');
 assert.equal(neon.engine,'postgres');
 assert.notStrictEqual(supabase.db,neon.db);
 assert.equal(calls.length,4);
 assert.equal(calls.filter(call=>call.url.includes('api.supabase.com')).length,1);
 assert.equal(calls.filter(call=>call.url.includes('console.neon.tech')).length,1);
 assert.ok(calls.filter(call=>call.url.includes('api.supabase.com')||
  call.url.includes('console.neon.tech')).every(call=>
   call.options.headers.authorization==='Bearer '+key));
 await supabase.db.destroy();
 await neon.db.destroy();
});

test('public db_connection read does not probe provider APIs',async()=>{
 const env={LOC_DB_PROFILE_SERVICE_TOKEN:'test-signed-profile-service-secret-long-enough'};
 const calls=[];
 const selected=await directMcpKysely(env,'public_supabase',{
  fetchImpl:async(url)=>{
   calls.push(url);
   if(!url.endsWith('/v1/internal/database/public_supabase'))
    throw Error('Public reads must not query provider API');
   return Response.json({engine:'postgres',db_type:'supabase',
    project_id:'abcdefghijklmnopqrst',provider_oauth:'provider-token',
    host:'db.example.net',port:6543,database:'postgres',
    username:'reader',password:'placeholder-only'});
  }});
 assert.equal(calls.length,1);
 await selected.db.destroy();
});

test('failed provider authorization halts the one-shot connection path',async()=>{
 const env={LOC_DB_PROFILE_SERVICE_TOKEN:'test-signed-profile-service-secret-long-enough'};
 let calls=0;
 await assert.rejects(directMcpKysely(env,'neon_test',{
  probeTicket:'00000000-0000-4000-8000-000000000003',
  fetchImpl:async(url)=>{
   calls++;
   if(url.endsWith('/v1/internal/database/neon_test'))
    return Response.json({engine:'postgres',db_type:'neon',
     project_id:'mellow-river-12345678',provider_oauth:'provider-token',
     host:'db.example.net',port:5432,database:'postgres',
     username:'reader',password:'placeholder-only'});
   return Response.json({error:'Forbidden'},{status:403});
  }}),error=>error.message.includes('Provider API rejected (403)'));
 assert.equal(calls,2);
});
