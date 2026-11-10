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
 const primary=DATABASE_ACCESS_LIST.find(target=>target.selected===true);
 if(!primary||!ALIAS.test(primary.connection_alias))
  throw fail('LOC primary database selection is not configured');
 const alias=verifiedAlias===primary.target_id||!verifiedAlias
  ?primary.connection_alias:verifiedAlias;
 if(!ALIAS.test(alias))throw fail('Invalid verified database alias');
 return alias;
}
async function authorizedProfile(env,alias,verifiedAlias,fetchImpl,probeTicket=''){
 const secret=String(env.LOC_DB_PROFILE_SERVICE_TOKEN||'');
 // All database profiles are owned by LOC Authority. Old deployment-local
 // profiles and environment aliases cannot override the selected SQL target.
 const control=DATABASE_ACCESS_LIST.find(item=>item.selected===true);
 const isPrimary=alias===control?.connection_alias&&
  (!verifiedAlias||verifiedAlias===control.target_id||
   verifiedAlias===control.connection_alias);
 if(secret.length<32)throw fail('Trusted LOC profile service is required');
 {
  // `loc_main` is a local connection alias, not LOC Auth's target ID.
  // The trusted profile route is keyed by target_id (e.g. loc-main).
  // The trusted Authority owns the selected main profile. The local
  // `loc_main` alias is only an in-process control pool name; never an
  // instruction to look up a phantom `loc-main` target.
  const selectedPrimary=DATABASE_ACCESS_LIST.find(item=>
   item.selected===true&&item.connection_alias===alias);
  const profileId=selectedPrimary&&isPrimary
   ?'primary':alias;
  const result=await fetchImpl('https://auth.lo3rwang.cc/v1/internal/database/'+profileId,{
   method:'GET',headers:{'x-loc-service-token':secret,accept:'application/json',
    ...(probeTicket?{'x-loc-probe-ticket':probeTicket}:{})},
   cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(8000)
  });
  if(!result.ok){
   // Authority publishes only stable diagnostic codes, never SQL credentials.
   const detail=await result.json().catch(()=>null);
   const allowed=new Set(['PRIMARY_TARGET_MISSING','PRIMARY_TARGET_INVALID',
     'DATABASE_TARGET_MISSING','SQL_VERIFICATION_REQUIRED']);
   const error=fail('LOC Authority profile lookup refused ('+result.status+')');
   error.code=allowed.has(detail?.code)?detail.code:'PROFILE_HTTP_'+result.status;
   throw error;
  }
  const profile=await result.json().catch(()=>null);
  // Identity/selection has already been checked in the signed LOC delegation.
  const verified=normalizeLiveTarget(profileId,profile);
  return {...verified.profile,schema_name:verified.target.schema_name,
   table_name:verified.target.table_name,field_map:verified.target.field_map};
 }
}
// Provider-specific official APIs live ONLY in db_connection. They prove
// that the saved project is accessible to the authorized provider identity.
// SQL host/port/credentials remain explicit and never come from a guessed
// region, a browser request or an alternative SQL driver.
const providerChecks=new WeakMap();
async function checkProviderApi(env,profile,fetchImpl){
 const type=String(profile.db_type||'direct');
 if(type==='direct')return;
 if(!['supabase','neon'].includes(type)||profile.engine!=='postgres')
  throw fail('Invalid SQL database provider or SQL Type');
 const project=String(profile.project_id||'');
 const token=String(profile.provider_oauth||'');
 if(!/^[A-Za-z0-9_-]{1,80}$/.test(project)||!token||/\s/.test(token))
  throw fail('Authorized provider API project and OAuth are required');
 let cache=providerChecks.get(env);
 if(!cache){cache=new Map();providerChecks.set(env,cache)}
 const key=type+'|'+project+'|'+token;
 const existing=cache.get(key);
 if(existing&&existing.until>Date.now()){
  if(existing.error)throw fail(existing.error);
  return existing.promise;
 }
 const url=type==='supabase'
  ?'https://api.supabase.com/v1/projects'
  :'https://console.neon.tech/api/v2/projects/'+encodeURIComponent(project);
 const pending=(async()=>{
  let response;
  try{
   response=await fetchImpl(url,{method:'GET',
    headers:{authorization:'Bearer '+token,accept:'application/json'},
    redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(7000)});
  }catch{throw fail('Provider API unavailable')}
  if(!response.ok)throw fail('Provider API rejected ('+response.status+')');
  const data=await response.json().catch(()=>null);
  const valid=type==='supabase'
   ?Array.isArray(data)&&data.some(item=>item&&
     (item.ref===project||item.id===project))
   :data?.project?.id===project;
  if(!valid)throw fail('Provider API project is not authorized');
 })();
 cache.set(key,{promise:pending,until:Date.now()+120000});
 try{
  await pending;
  // Bound the isolate-local memo; it contains no public or persistent token.
  if(cache.size>16)cache.clear();
 }catch(error){
  cache.set(key,{error:String(error.message||'Provider API unavailable'),
   until:Date.now()+300000});
  throw error;
 }
}
function validateProfile(env,profile,verifiedAlias){
 const engine=String(profile.engine||'');
 if(!['postgres','mysql','mssql'].includes(engine))
  throw fail('LOC MCP database engine is unsupported');
 const url=String(profile.url||'');
 let parsed;
 try{parsed=new URL(url)}catch{throw fail('LOC database connection URL invalid')}
 const schemes={postgres:['postgres:','postgresql:'],mysql:['mysql:'],
  mssql:['mssql:','sqlserver:']};
 if(!schemes[engine].includes(parsed.protocol)||!parsed.hostname)
  throw fail('LOC '+engine+' connection URL invalid');
 // The owner supplies the port, including nonstandard pooler ports (6543).
 // No default or supplier-driven port derivation is allowed.
 const explicitPort=Number(parsed.port);
 if(!Number.isInteger(explicitPort)||explicitPort<1||explicitPort>65535)
  throw fail('LOC SQL connection requires the configured server port');
 const namespace=engine==='mysql'?'':String(profile.schema_name||
  (engine==='mssql'?'dbo':'silver'));
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
 // Presence of the service credential is not proof of a SQL connection or
 // permission to write. Callers must verify the selected Authority profile.
 const configured=String(env.LOC_DB_PROFILE_SERVICE_TOKEN||'').length>=32;
 return {
  publicReadConfigured:false,
  privateReadConfigured:configured,
  privateWriteConfigured:false,
  verification:'configuration-only'
 };
}
async function newDialect({engine,profile,parsed}){
 if(engine==='postgres'){
  return new PostgresDialect({pool:new pg.Pool({
   connectionString:profile.url,max:1,idleTimeoutMillis:12000,
   connectionTimeoutMillis:7000,
   ...(profile.tls===false?{ssl:false}:{ssl:{rejectUnauthorized:true}})
  })});
 }
 if(engine==='mysql'){
  const module=await import('mysql2');
  const createPool=module.createPool||module.default?.createPool;
  if(typeof createPool!=='function')throw fail('MySQL protocol driver unavailable');
  return new MysqlDialect({pool:createPool({
   host:parsed.hostname,port:Number(parsed.port),
   user:decodeURIComponent(parsed.username),password:decodeURIComponent(parsed.password),
   database:decodeURIComponent(parsed.pathname.slice(1)),
   waitForConnections:false,connectionLimit:1,queueLimit:0,
   ...(profile.tls===false?{}:{ssl:{rejectUnauthorized:true}}),
   ...mysqlLdapOptions(profile)
  })});
 }
 const Tedious=await import('tedious'),Tarn=await import('tarn');
 return new MssqlDialect({
  tarn:{...Tarn,options:{min:0,max:1}},
  tedious:{...Tedious,connectionFactory:()=>new Tedious.Connection({
   server:parsed.hostname,
   authentication:mssqlAuthentication(profile,
    decodeURIComponent(parsed.username),decodeURIComponent(parsed.password)),
   options:{database:decodeURIComponent(parsed.pathname.slice(1)),
    port:Number(parsed.port),encrypt:profile.tls!==false,
    trustServerCertificate:false,connectTimeout:7000}
  })}
 });
}
export async function db_connection(env={},verifiedAlias='',{
 fetchImpl=globalThis.fetch,probeTicket=''
}={}){
 if(!env||typeof env!=='object')throw fail('Invalid LOC MCP backend environment');
 if(verifiedAlias&&!ALIAS.test(verifiedAlias))throw fail('Invalid verified database alias');
 if(probeTicket&&!/^[0-9a-f-]{36}$/.test(probeTicket))
  throw fail('Invalid one-time SQL verification ticket');
 const alias=trustedAlias(env,verifiedAlias);
 const profile=await authorizedProfile(env,alias,verifiedAlias,fetchImpl,probeTicket);
 // Provider API metadata is checked only during a user-initiated probe.
 // Public reads, search and MCP never perform implicit provider API checks.
 if(probeTicket)await checkProviderApi(env,profile,fetchImpl);
 const input=validateProfile(env,profile,verifiedAlias);
 const {engine,namespace,tableName,fieldMap}=input;
 const key=alias+'|'+engine+'|'+profile.url+'|'+profile.tls+'|'+namespace+
  '|'+tableName+'|'+JSON.stringify(fieldMap)+'|'+JSON.stringify(profile.authentication||{});
 let cache=targets.get(env);
 if(!cache){cache=new Map();targets.set(env,cache)}
 if(!probeTicket&&cache.has(key))return cache.get(key);
 const create=async()=>{
  const dialect=await newDialect(input);
  const db=new Kysely({dialect});
  // Exposed so a trusted caller can layer ZenStack+PolicyPlugin on the SAME
  // dialect/pool for the four fixed public control models, without opening
  // a second connection. See zenstack/policy-runtime.mjs:fixedPolicyReader.
  return {db,dialect,engine,namespace,tableName,fieldMap};
 };
 const promise=create();
 // Manual probing is single-use, not a reusable cached connection. The
 // caller owns and destroys its one temporary pool immediately after testing.
 if(probeTicket)return promise;
 cache.set(key,promise);
 try{return await promise}catch(error){cache.delete(key);throw error}
}

// Legacy import name is the same function, not a second SQL connection path.
export {db_connection as directMcpKysely};
