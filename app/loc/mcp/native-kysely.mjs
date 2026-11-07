// Kysely runs inside the existing LOC MCP application runtime, not via SQL Gateway.
// The database login is server-only; neither OAuth nor an HTTP caller chooses a URL.
import {Kysely,PostgresDialect} from 'kysely';
import pg from 'pg';

const targets=new WeakMap();
const ALIAS=/^[a-z][a-z0-9_-]{0,63}$/;
function fail(message){
  return Object.assign(new Error(message),{code:'BACKEND_UNAVAILABLE'});
}
function selectedProfile(env,verifiedAlias=''){
  // The override may ONLY be supplied by LOC Auth's verified Scope permit.
  // Never map an HTTP request field to this argument.
  const alias=String(verifiedAlias||env.LOC_MCP_DB_ALIAS||env.LOC_CONTROL_DB_ALIAS||'');
  if(!ALIAS.test(alias))throw fail('LOC MCP direct database alias is not configured');
  let profiles;
  try{profiles=JSON.parse(String(env.LOC_DB_CONNECTIONS_JSON||'{}'))}
  catch{throw fail('LOC direct database profiles have invalid JSON')}
  if(!profiles||typeof profiles!=='object'||Array.isArray(profiles))
    throw fail('LOC direct database profiles are invalid');
  const profile=Object.hasOwn(profiles,alias)?profiles[alias]:null;
  if(!profile||typeof profile!=='object'||Array.isArray(profile))
    throw fail('LOC MCP database alias does not exist');
  const engine=String(profile.engine||'');
  if(!['postgres','mysql','mssql'].includes(engine))
    throw fail('LOC MCP database engine is unsupported');
  if(!verifiedAlias&&env.LOC_MCP_DB_ENGINE&&env.LOC_MCP_DB_ENGINE!==engine)
    throw fail('LOC MCP database engine mismatch');
  if(typeof profile.url!=='string'||!profile.url)
    throw fail('LOC MCP database connection is unavailable');
  // Do not silently route an unimplemented dialect to a provider Data API.
  if(engine!=='postgres')
    throw fail('MCP application runtime needs a native '+engine+' driver');
  let uri;
  try{uri=new URL(profile.url)}catch{throw fail('Invalid LOC MCP database connection')}
  if(!['postgres:','postgresql:'].includes(uri.protocol)||!uri.hostname)
    throw fail('LOC MCP PostgreSQL connection URL is invalid');
  return {alias,engine,profile,namespace:String(env.LOC_MCP_DB_NAMESPACE||'silver')};
}
export function directMcpKysely(env={},verifiedAlias=''){
  if(!env||typeof env!=='object')throw fail('Invalid LOC MCP backend environment');
  if(verifiedAlias&&!ALIAS.test(verifiedAlias))throw fail('Invalid verified database alias');
  const {alias,engine,profile,namespace}=selectedProfile(env,verifiedAlias);
  if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(namespace))
    throw fail('Invalid LOC MCP database namespace');
  const key=alias+'|'+profile.url+'|'+profile.tls+'|'+namespace;
  let cache=targets.get(env);
  if(!cache){cache=new Map();targets.set(env,cache)}
  const existing=cache.get(key);
  if(existing)return existing;
  const pool=new pg.Pool({
    connectionString:profile.url,max:2,idleTimeoutMillis:12000,
    connectionTimeoutMillis:7000,
    ssl:profile.tls===false?false:{rejectUnauthorized:true}
  });
  const entry={db:new Kysely({dialect:new PostgresDialect({pool})}),engine,namespace};
  cache.set(key,entry);
  return entry;
}
