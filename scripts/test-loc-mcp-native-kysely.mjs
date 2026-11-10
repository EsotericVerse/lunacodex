import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {directMcpKysely,mcpDatabaseConfiguration} from '../app/loc/mcp/native-kysely.mjs';

const url='postgresql://app:password@127.0.0.1:5432/database';
const profile={engine:'postgres',url,tls:true};
const configured=()=>({LOC_MCP_DB_ALIAS:'control',
 LOC_DB_CONNECTIONS_JSON:JSON.stringify({control:profile})});

test('MCP distinguishes OAuth connectivity from actual native database configuration',()=>{
 const empty=mcpDatabaseConfiguration({});
 assert.deepEqual(empty,{publicReadConfigured:false,privateReadConfigured:false,
  privateWriteConfigured:false,verification:'configuration-only'});
 assert.deepEqual(mcpDatabaseConfiguration({LOC_MCP_DB_ALIAS:'control',
  LOC_DB_CONNECTIONS_JSON:'bad json'}),empty);
 const configuredStatus=mcpDatabaseConfiguration(configured());
 assert.equal(configuredStatus.publicReadConfigured,true);
 assert.equal(configuredStatus.privateReadConfigured,true);
 assert.equal(configuredStatus.privateWriteConfigured,true);
 const delegated=mcpDatabaseConfiguration({
  LOC_DB_PROFILE_SERVICE_TOKEN:'trusted-profile-token-at-least-32-characters'});
 assert.equal(delegated.publicReadConfigured,false);
 assert.equal(delegated.privateReadConfigured,true);
 assert.equal(delegated.privateWriteConfigured,true);
 assert.equal(JSON.stringify(delegated).includes('trusted-profile-token'),false);
 const badEngine=mcpDatabaseConfiguration({LOC_MCP_DB_ALIAS:'control',
  LOC_DB_CONNECTIONS_JSON:JSON.stringify({control:{engine:'sqlite',url}})});
 assert.equal(badEngine.publicReadConfigured,false);
});
test('trusted alias reuses one in-process Kysely pool',async()=>{
 const env=configured();
 const first=await directMcpKysely(env),second=await directMcpKysely(env);
 assert.equal(first,second);
 assert.equal(first.engine,'postgres');
 assert.equal(first.namespace,'silver');
 assert.equal(typeof first.db.selectFrom,'function');
 // dialect is exposed so a trusted caller can build a ZenStack+PolicyPlugin
 // reader on the SAME dialect/pool (zenstack/policy-runtime.mjs), not a
 // second connection.
 assert.equal(typeof first.dialect.createDriver,'function');
 assert.deepEqual(Object.keys(first).sort(),['db','dialect','engine','fieldMap','namespace','tableName']);
});
test('missing/mismatched trusted profiles fail closed',async()=>{
 await assert.rejects(directMcpKysely({}),/alias is not configured/);
 await assert.rejects(directMcpKysely({...configured(),LOC_MCP_DB_ALIAS:'bad/alias'}),/alias is not configured/);
 await assert.rejects(directMcpKysely({...configured(),LOC_DB_CONNECTIONS_JSON:'not-json'}),/invalid JSON/);
 await assert.rejects(directMcpKysely({...configured(),LOC_DB_CONNECTIONS_JSON:'{}'}),/alias does not exist/);
 await assert.rejects(directMcpKysely({...configured(),LOC_MCP_DB_ENGINE:'mssql'}),/engine mismatch/);
 await assert.rejects(directMcpKysely({...configured(),LOC_DB_CONNECTIONS_JSON:
  JSON.stringify({control:{engine:'postgres',url:'https://example.com/rest/v1'}})}),/connection URL invalid/);
});
test('Kysely really chooses Postgres, MySQL and SQL Server SQL dialect',async()=>{
 const input=[
  ['postgres','postgresql://app:pass@127.0.0.1:5432/loc','silver'],
  ['mysql','mysql://app:pass@127.0.0.1:3306/loc',''],
  ['mssql','mssql://app:pass@127.0.0.1:1433/loc','dbo']
 ];
 for(const [engine,url,namespace] of input){
  const env={LOC_MCP_DB_ALIAS:'source',LOC_DB_CONNECTIONS_JSON:
   JSON.stringify({source:{engine,url,tls:false}})};
  const selected=await directMcpKysely(env);
  assert.equal(selected.engine,engine);
  assert.equal(selected.namespace,namespace);
  const name=namespace?namespace+'.galaxy':'galaxy';
  const query=selected.db.selectFrom(name).select('uid').limit(2).compile();
  if(engine==='postgres')assert.match(query.sql,/"silver"\."galaxy"/);
  if(engine==='mysql')assert.match(query.sql,/\`galaxy\`/);
  if(engine==='mssql')assert.match(query.sql,/"dbo"\."galaxy"/);
  await selected.db.destroy();
 }
});
test('live Auth-selected profile is resolved only through trusted server secret',async()=>{
 const env={LOC_MCP_DB_ALIAS:'primary',
  LOC_DB_PROFILE_SERVICE_TOKEN:'backend-only-secret-with-at-least-32-bytes',
  LOC_DB_CONNECTIONS_JSON:'{}'};
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
test('configured LOC Auth overrides legacy local SQL profiles for the main target',async()=>{
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

test('the primary SQL Model Gateway never restores a deployment database URL',()=>{
 const source=readFileSync(new URL('../app/loc/mcp/native-kysely.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(source,/LOC_DATABASE_URL|mainDatabaseProfile/);
 assert.match(source,/LOC_DB_PROFILE_SERVICE_TOKEN/);
 assert.match(source,/normalizeLiveTarget/);
 assert.match(source,/PostgresDialect|MysqlDialect|MssqlDialect/);
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
