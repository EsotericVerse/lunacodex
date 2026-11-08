import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {directMcpKysely} from '../app/loc/mcp/native-kysely.mjs';

const url='postgresql://app:password@127.0.0.1:5432/database';
const profile={engine:'postgres',url,tls:true};
const configured=()=>({LOC_MCP_DB_ALIAS:'control',
 LOC_DB_CONNECTIONS_JSON:JSON.stringify({control:profile})});

test('trusted alias reuses one in-process Kysely pool',async()=>{
 const env=configured();
 const first=await directMcpKysely(env),second=await directMcpKysely(env);
 assert.equal(first,second);
 assert.equal(first.engine,'postgres');
 assert.equal(first.namespace,'silver');
 assert.equal(typeof first.db.selectFrom,'function');
 assert.deepEqual(Object.keys(first).sort(),['db','engine','fieldMap','namespace','tableName']);
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
  if(engine==='mssql')assert.match(query.sql,/\[dbo\]\.\[galaxy\]/);
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
