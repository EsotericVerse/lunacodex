// LOC native Kysely Driver: the selected SQL engine controls its real wire
// protocol. SQL always executes here in the trusted application, never through
// LOC Auth or an HTTP SQL Gateway.
import {Kysely,PostgresDialect,MysqlDialect,MssqlDialect} from 'kysely';
import pg from 'pg';
import {mssqlAuthentication,mysqlLdapOptions} from '../providers/sql-driver-auth.mjs';
import {normalizeLiveTarget} from '../providers/live-database-target.mjs';
import {DATABASE_ACCESS_LIST} from '../providers/access.js';

const targets=new WeakMap();
const ALIAS=/^[a-z][a-z0-9_-]{0,63}$/;
const IDENT=/^[A-Za-z][A-Za-z0-9_]{0,119}$/;
function fail(message){
 return Object.assign(new Error(message),{code:'BACKEND_UNAVAILABLE'});
}
function trustedAlias(env,verifiedAlias){
 // The deployed Pages app already publishes the fixed database selection.
 // The trusted service token enables resolving that alias without SQL or a
 // duplicate deployment-local connection password.
 const profileService=String(env.LOC_DB_PROFILE_SERVICE_TOKEN||'');
 const published=profileService.length>=32||Boolean(env.LOC_DATABASE_URL)?
  DATABASE_ACCESS_LIST.find(target=>target.selected===true)?.connection_alias:'';
 const alias=String(verifiedAlias||env.LOC_MCP_DB_ALIAS||
  env.LOC_CONTROL_DB_ALIAS||env.LOC_PUBLIC_DB_ALIAS||published||'');
 if(!ALIAS.test(alias))throw fail('LOC MCP direct database alias is not configured');
 return alias;
}
function localProfile(env,alias){
 let profiles;
 try{profiles=JSON.parse(String(env.LOC_DB_CONNECTIONS_JSON||'{}'))}
 catch{throw fail('LOC direct database profiles have invalid JSON')}
 if(!profiles||typeof profiles!=='object'||Array.isArray(profiles))
  throw fail('LOC direct database profiles are invalid');
 const profile=Object.hasOwn(profiles,alias)?profiles[alias]:null;
 if(!profile||typeof profile!=='object'||Array.isArray(profile))
  throw fail('LOC MCP database alias does not exist');
 if(typeof profile.url!=='string'||!profile.url)
  throw fail('LOC MCP database connection is unavailable');
 return profile;
}
async function authorizedProfile(env,alias,verifiedAlias,fetchImpl){
 const secret=String(env.LOC_DB_PROFILE_SERVICE_TOKEN||'');
 // Explicit local profiles stay valid for self-hosting, but do not override
 // a user-selected alias signed by LOC Auth.
 if(!verifiedAlias&&env.LOC_DB_CONNECTIONS_JSON)
  return localProfile(env,alias);
 // Primary database wiring is a backend-owned PostgreSQL driver connection.
 // Never route its credential via LOC Auth or expose it to browser OAuth.
 const control=DATABASE_ACCESS_LIST.find(item=>item.selected===true);
 if(!verifiedAlias&&alias===control?.connection_alias&&env.LOC_DATABASE_URL)
  return {engine:'postgres',url:String(env.LOC_DATABASE_URL),tls:true,
   schema_name:'silver'};
 if(secret){
  if(secret.length<32)throw fail('LOC trusted profile secret is invalid');
  // `loc_main` is a local connection alias, not LOC Auth's target ID.
  // The trusted profile route is keyed by target_id (e.g. loc-main).
  const control=verifiedAlias?'':DATABASE_ACCESS_LIST.find(item=>
   item.selected===true&&item.connection_alias===alias)?.target_id;
  const profileId=control||alias;
  const result=await fetchImpl('https://auth.lo3rwang.cc/v1/internal/database/'+profileId,{
   method:'GET',headers:{'x-loc-service-token':secret,accept:'application/json'},
   cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(8000)
  });
  if(!result.ok)throw fail('LOC Authority profile lookup refused ('+result.status+')');
  const profile=await result.json().catch(()=>null);
  // Identity/selection has already been checked in the signed LOC delegation.
  const verified=normalizeLiveTarget(profileId,profile);
  return {...verified.profile,schema_name:verified.target.schema_name,
   table_name:verified.target.table_name,field_map:verified.target.field_map};
 }
 return localProfile(env,alias);
}
function validateProfile(env,profile,verifiedAlias){
 const engine=String(profile.engine||'');
 if(!['postgres','mysql','mssql'].includes(engine))
  throw fail('LOC MCP database engine is unsupported');
 if(!verifiedAlias&&env.LOC_MCP_DB_ENGINE&&env.LOC_MCP_DB_ENGINE!==engine)
  throw fail('LOC MCP database engine mismatch');
 const url=String(profile.url||'');
 let parsed;
 try{parsed=new URL(url)}catch{throw fail('LOC database connection URL invalid')}
 const schemes={postgres:['postgres:','postgresql:'],mysql:['mysql:'],
  mssql:['mssql:','sqlserver:']};
 if(!schemes[engine].includes(parsed.protocol)||!parsed.hostname)
  throw fail('LOC '+engine+' connection URL invalid');
 const namespace=engine==='mysql'?'':String(profile.schema_name||
  env.LOC_MCP_DB_NAMESPACE||(engine==='mssql'?'dbo':'silver'));
 const tableName=String(profile.table_name||'');
 const fieldMap=profile.field_map||{};
 if(namespace&&!IDENT.test(namespace)||tableName&&!IDENT.test(tableName)||
  !fieldMap||typeof fieldMap!=='object'||Array.isArray(fieldMap)||
  Object.entries(fieldMap).some(([key,value])=>!IDENT.test(key)||
   typeof value!=='string'||!IDENT.test(value)))
  throw fail('Invalid LOC SQL mapping');
 return {engine,profile,namespace,tableName,fieldMap,parsed};
}
// Configuration-only introspection: never opens a connection, reads a record,
// resolves a subject, or includes a credential/alias in the MCP response.
// A configured profile is NOT proof that its database is reachable.
export function mcpDatabaseConfiguration(env={}){
 let publicReadConfigured=false;
 try{
  const alias=trustedAlias(env,'');
  const control=DATABASE_ACCESS_LIST.find(item=>item.selected===true);
  const profile=!env.LOC_DB_CONNECTIONS_JSON&&env.LOC_DATABASE_URL&&
   alias===control?.connection_alias
   ?{engine:'postgres',url:String(env.LOC_DATABASE_URL),tls:true,schema_name:'silver'}
   :localProfile(env,alias);
  validateProfile(env,profile,'');
  publicReadConfigured=true;
 }catch{} // Missing or invalid local configuration is reported, never leaked.
 const delegatedProfileConfigured=typeof env.LOC_DB_PROFILE_SERVICE_TOKEN==='string'&&
  env.LOC_DB_PROFILE_SERVICE_TOKEN.length>=32;
 return {
  publicReadConfigured,
  privateReadConfigured:publicReadConfigured||delegatedProfileConfigured,
  privateWriteConfigured:publicReadConfigured||delegatedProfileConfigured,
  verification:'configuration-only'
 };
}
async function newDialect({engine,profile,parsed}){
 if(engine==='postgres'){
  return new PostgresDialect({pool:new pg.Pool({
   connectionString:profile.url,max:2,idleTimeoutMillis:12000,
   connectionTimeoutMillis:7000,
   ...(profile.tls===false?{ssl:false}:{ssl:{rejectUnauthorized:true}})
  })});
 }
 if(engine==='mysql'){
  const module=await import('mysql2');
  const createPool=module.createPool||module.default?.createPool;
  if(typeof createPool!=='function')throw fail('MySQL protocol driver unavailable');
  return new MysqlDialect({pool:createPool({
   host:parsed.hostname,port:Number(parsed.port)||3306,
   user:decodeURIComponent(parsed.username),password:decodeURIComponent(parsed.password),
   database:decodeURIComponent(parsed.pathname.slice(1)),
   waitForConnections:true,connectionLimit:2,queueLimit:10,
   ...(profile.tls===false?{}:{ssl:{rejectUnauthorized:true}}),
   ...mysqlLdapOptions(profile)
  })});
 }
 const Tedious=await import('tedious'),Tarn=await import('tarn');
 return new MssqlDialect({
  tarn:{...Tarn,options:{min:0,max:2}},
  tedious:{...Tedious,connectionFactory:()=>new Tedious.Connection({
   server:parsed.hostname,
   authentication:mssqlAuthentication(profile,
    decodeURIComponent(parsed.username),decodeURIComponent(parsed.password)),
   options:{database:decodeURIComponent(parsed.pathname.slice(1)),
    port:Number(parsed.port)||1433,encrypt:profile.tls!==false,
    trustServerCertificate:false,connectTimeout:7000}
  })}
 });
}
export async function directMcpKysely(env={},verifiedAlias='',{
 fetchImpl=globalThis.fetch
}={}){
 if(!env||typeof env!=='object')throw fail('Invalid LOC MCP backend environment');
 if(verifiedAlias&&!ALIAS.test(verifiedAlias))throw fail('Invalid verified database alias');
 const alias=trustedAlias(env,verifiedAlias);
 const profile=await authorizedProfile(env,alias,verifiedAlias,fetchImpl);
 const input=validateProfile(env,profile,verifiedAlias);
 const {engine,namespace,tableName,fieldMap}=input;
 const key=alias+'|'+engine+'|'+profile.url+'|'+profile.tls+'|'+namespace+
  '|'+tableName+'|'+JSON.stringify(fieldMap)+'|'+JSON.stringify(profile.authentication||{});
 let cache=targets.get(env);
 if(!cache){cache=new Map();targets.set(env,cache)}
 if(cache.has(key))return cache.get(key);
 const create=async()=>{
  const dialect=await newDialect(input);
  const db=new Kysely({dialect});
  // Exposed so a trusted caller can layer ZenStack+PolicyPlugin on the SAME
  // dialect/pool for the four fixed public control models, without opening
  // a second connection. See zenstack/policy-runtime.mjs:fixedPolicyReader.
  return {db,dialect,engine,namespace,tableName,fieldMap};
 };
 const promise=create();
 cache.set(key,promise);
 try{return await promise}catch(error){cache.delete(key);throw error}
}
