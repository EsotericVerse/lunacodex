// The LOC business backend opens its own PostgreSQL connection.
// It never asks LOC Auth for database credentials, profiles, targets or SQL.
import {Kysely,PostgresDialect} from 'kysely';
import pg from 'pg';
import {DATABASE_ACCESS_LIST} from '../providers/access.js';

// Cloudflare request env wrappers can have different identities. Keep one
// trusted business connection per isolate, not a new pool per HTTP request.
let cachedConnection=null;
const primary=DATABASE_ACCESS_LIST.find(row=>row.selected===true);
function unavailable(message){
  return Object.assign(new Error(message),{code:'BACKEND_UNAVAILABLE',httpStatus:503});
}
function mainUri(env){
  const value=String(env?.LOC_DATABASE_URI||'').trim();
  if(!value)throw unavailable('LOC primary PostgreSQL connection missing');
  let url;
  try{url=new URL(value)}catch{throw unavailable('LOC primary PostgreSQL URI malformed')}
  if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname||
     !url.username||!url.password||url.pathname.length<=1)
    throw unavailable('LOC primary PostgreSQL URI incomplete');
  return value;
}
// Pool-shaped adapter for Kysely: one fresh pg.Client per connect(), closed on
// release. Holds no sockets or waiters between requests.
// One failed connection opens a five-minute local circuit breaker.
// Never retry connections, poll for recovery, or call Neon during cooldown.
// This is per worker isolate, not a cross-region/distributed guarantee.
export const NEON_CONNECTION_COOLDOWN_MS=5*60*1000;
export function requestScopedPool(options,ClientClass=pg.Client,
    {cooldownMs=NEON_CONNECTION_COOLDOWN_MS,now=Date.now}={}){
  let blockedUntil=0;
  let connecting=null;
  return {
    async connect(){
      if(now()<blockedUntil)throw unavailable('LOC database connection cooling down');
      // Do not give two SQL operations the same pg.Client: transactions and
      // results would interleave. A simultaneous caller may wait for the
      // first acquisition outcome, then open its *own* request-scoped client.
      if(connecting){
        try{await connecting;}catch{}
        if(now()<blockedUntil)throw unavailable('LOC database connection cooling down');
      }
      const attempt=(async()=>{
        const client=new ClientClass(options);
        client.on?.('error',()=>{});
        try{
          await client.connect();
          blockedUntil=0;
          client.release=()=>{void Promise.resolve(client.end()).catch(()=>{});};
          return client;
        }catch(error){
          blockedUntil=now()+cooldownMs;
          void Promise.resolve(client.end?.()).catch(()=>{});
          throw error;
        }
      })();
      connecting=attempt;
      try{return await attempt}
      finally{if(connecting===attempt)connecting=null}
    },
    async end(){}
  };
}
export function mcpDatabaseConfiguration(env={}){
  const configured=Boolean(String(env?.LOC_DATABASE_URI||'').trim());
  return {publicReadConfigured:configured,privateReadConfigured:configured,
    privateWriteConfigured:configured,verification:'configuration-only'};
}
export async function db_connection(env={},verifiedAlias='',{probeTicket=''}={}){
  if(!env||typeof env!=='object')throw unavailable('LOC backend environment missing');
  // A caller's string can never select a different SQL target. LOC currently
  // uses one production Neon PostgreSQL database for its business data.
  if(verifiedAlias&&verifiedAlias!==primary?.target_id&&
     verifiedAlias!==primary?.connection_alias)
    throw unavailable('Additional database connection not configured');
  if(probeTicket)throw unavailable('Manual probe is not a business SQL operation');
  const uri=mainUri(env);
  if(cachedConnection?.uri===uri)return cachedConnection.connection;
  // Cloudflare forbids using a socket or waiting on a promise that was created
  // in another request. A shared pg.Pool therefore hangs/crashes (HTTP 500)
  // when several requests run queries at once. Open a short-lived client per
  // acquisition instead; it always lives inside the request that uses it.
  const pool=requestScopedPool({connectionString:uri,
    connectionTimeoutMillis:3500,ssl:{rejectUnauthorized:true}});
  const dialect=new PostgresDialect({pool});
  const connection={db:new Kysely({dialect}),dialect,
    engine:'postgres',namespace:'silver',tableName:'',fieldMap:{}};
  cachedConnection={uri,connection};
  return connection;
}
export {db_connection as directMcpKysely};
