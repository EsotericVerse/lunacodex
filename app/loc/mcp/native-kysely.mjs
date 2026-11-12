// The LOC business backend opens its own PostgreSQL connection.
// It never asks LOC Auth for database credentials, profiles, targets or SQL.
import {Kysely} from 'kysely';
import pg from 'pg';
import {DATABASE_ACCESS_LIST} from '../providers/access.js';
import {createKyselyDialect} from '../providers/kysely-dialects.mjs';

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
// A Free-plan Neon compute suspends after ~5 minutes idle; the first connection
// after that can fail while it wakes. Only the connect step is retried (nothing
// has been sent yet, so it is always safe); queries are never retried.
export function requestScopedPool(options,ClientClass=pg.Client,
    {attempts=2,delayMs=400}={}){
  return {
    async connect(){
      let lastError;
      for(let attempt=1;attempt<=attempts;attempt++){
        const client=new ClientClass(options);
        client.on?.('error',()=>{});
        try{
          await client.connect();
          client.release=()=>{void Promise.resolve(client.end()).catch(()=>{});};
          return client;
        }catch(error){
          lastError=error;
          void Promise.resolve(client.end?.()).catch(()=>{});
          if(attempt<attempts)await new Promise(resolve=>setTimeout(resolve,delayMs));
        }
      }
      throw lastError;
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
  // Use Kysely's upstream dialect factory. LOC's selected primary remains
  // PostgreSQL today, while the same trusted boundary can compile MySQL or
  // SQL Server targets when their caller-supplied pool is enabled.
  const dialect=createKyselyDialect(primary?.engine||'postgres',{pool});
  const connection={db:new Kysely({dialect}),dialect,
    engine:'postgres',namespace:'silver',tableName:'',fieldMap:{}};
  cachedConnection={uri,connection};
  return connection;
}
export {db_connection as directMcpKysely};
