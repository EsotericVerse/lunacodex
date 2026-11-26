// The LOC backend opens the server-owned PostgreSQL control connection.
// Externally selected SQL targets are read-only and require BOTH a verified
// alias and a trusted, server-supplied profile plus the engine's native driver.
// Neither HTTP parameters nor OAuth claims supply raw connection credentials.
import {Kysely} from 'kysely';
import {readLocHyperdriveMode} from './hyperdrive-mode.mjs';
import pg from 'pg';
import {DATABASE_ACCESS_LIST} from '../providers/access.js';
import {normalizeLiveTarget} from '../providers/live-database-target.mjs';
import {createKyselyDialect,getSqlType} from '../../../modules/loc/dialect/index.mjs';
import {requestScopedPool} from './postgres-pool.mjs';
import {isCloudflareWorkerRuntime,locHyperdriveBinding,resolveLocConnectionProvider}
  from './connection-provider.mjs';
import {CONNECTION_POOL_POLICY} from './connection-pool-policy.mjs';

// The trusted Kysely dialect and its request-owned pg.Client share the
// current request lifetime. No platform-specific background cleanup is needed.
const primary=DATABASE_ACCESS_LIST.find(row=>row.selected===true);
function unavailable(message){
  return Object.assign(new Error(message),{code:'BACKEND_UNAVAILABLE',httpStatus:503});
}
function mainPostgresUri(env){
  const value=String(env?.LOC_DATABASE_URI||'').trim();
  if(!value)throw unavailable('LOC primary PostgreSQL connection missing');
  let url;
  try{url=new URL(value)}catch{throw unavailable('LOC primary PostgreSQL URI malformed')}
  if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname||
     !url.username||!url.password||url.pathname.length<=1)
    throw unavailable('LOC primary PostgreSQL URI incomplete');
  return value;
}
export {locHyperdriveBinding,resolveLocConnectionProvider,requestScopedPool};
const NODE_POOL_KEY=Symbol.for('loc.native-kysely.node-pool');
function nodePostgresProcessPool(uri){
  const current=globalThis[NODE_POOL_KEY];
  if(current?.uri===uri&&!current.pool.ended)return current.pool;
  if(current?.pool)void current.pool.end().catch(()=>{});
  const pool=new pg.Pool({connectionString:uri,
    max:CONNECTION_POOL_POLICY.nodePoolMax,
    idleTimeoutMillis:CONNECTION_POOL_POLICY.nodeIdleTimeoutMillis,
    connectionTimeoutMillis:CONNECTION_POOL_POLICY.connectionTimeoutMillis});
  globalThis[NODE_POOL_KEY]={uri,pool};
  return pool;
}

export async function db_connection(env={},verifiedAlias='',{
  probeTicket='',trustedTarget=null,trustedDialectConfig=null,
  forceDirect=false,forceHyperdrive=false,modeReader=readLocHyperdriveMode
}={}){
  if(!env||typeof env!=='object')throw unavailable('LOC backend environment missing');
  if(probeTicket)throw unavailable('Manual probe is not a business SQL operation');
  if(forceDirect&&forceHyperdrive)
    throw unavailable('Conflicting LOC connection mode request');
  const external=Boolean(verifiedAlias&&verifiedAlias!==primary?.target_id&&
    verifiedAlias!==primary?.connection_alias);
  if(external){
    // The OAuth claim identifies an alias only. Opening it is impossible until
    // the trusted backend supplies a validated Authority profile and actual
    // Kysely pool/tedious drivers for THIS request. Neither can be selected
    // through the HTTP body. No fallback to the control database is allowed.
    if(!trustedTarget||!trustedDialectConfig)
      throw unavailable('Additional database connection not configured');
    const {target,profile}=normalizeLiveTarget(verifiedAlias,trustedTarget);
    const engine=profile.engine;
    const dialect=createKyselyDialect(engine,trustedDialectConfig);
    const db=new Kysely({dialect});
    return {db,dialect,engine,
      namespace:target.schema_name??getSqlType(engine).defaultNamespace,
      tableName:target.table_name||'',
      fieldMap:target.field_map||{},
      // Kysely owns the selected driver's pool. Do not close the primary
      // request-scoped PG pool or share a resource across server requests.
      abort:()=>db.destroy()};
  }
  if(trustedTarget||trustedDialectConfig)
    throw unavailable('The LOC control database cannot be replaced');
  if(!primary||primary.engine!=='postgres'||
     typeof primary.schema_name!=='string'||!primary.schema_name)
    throw unavailable('LOC primary SQL Type or schema is not explicitly configured');
  const isCloudflareWorkers=isCloudflareWorkerRuntime();
  // Provider selection is independent of the explicitly configured SQL Type.
  const connectionRoute=await resolveLocConnectionProvider(env,{
    forceDirect,forceHyperdrive,
    requireBinding:forceHyperdrive||isCloudflareWorkers
  });
  if(connectionRoute.provider==='hyperdrive'){
    const hyperdriveUri=connectionRoute.connectionString;
    // Hyperdrive owns the cross-request origin pool. Each Worker request still
    // owns its pg.Client and closes it at the normal/error/abort boundary.
    const pool=requestScopedPool({
      connectionString:hyperdriveUri,
      connectionTimeoutMillis:6000
    },pg.Client,{
      attempts:2,attemptTimeoutMs:4000,maxElapsedMs:6500,
      baseDelayMs:200,maxDelayMs:500
    });
    const dialect=createKyselyDialect(primary.engine,{pool});
    const connection={db:new Kysely({dialect}),dialect,pool,
      engine:'postgres',namespace:primary.schema_name,tableName:'',fieldMap:{},
      connectionProvider:connectionRoute.provider,
      connectionMode:connectionRoute.connectionMode};
    if(!forceHyperdrive){
      let enabled;
      try{enabled=await modeReader(connection.db);}
      catch{
        try{await closeLocDatabase(connection);}catch{}
        throw unavailable('LOC Hyperdrive mode unavailable');
      }
      if(enabled===false){
        await closeLocDatabase(connection);
        return db_connection(env,verifiedAlias,{
          probeTicket,trustedTarget,trustedDialectConfig,
          forceDirect:true,modeReader
        });
      }
    }
    return connection;
  }
  const uri=mainPostgresUri(env);
  if(!isCloudflareWorkers){
    const pool=nodePostgresProcessPool(uri);
    const dialect=createKyselyDialect(primary.engine,{pool});
    return {db:new Kysely({dialect}),dialect,
      engine:primary.engine,namespace:primary.schema_name,
      tableName:'',fieldMap:{},pool,sharedPool:true,
      connectionProvider:connectionRoute.provider,
      connectionMode:connectionRoute.connectionMode};
  }
  // Cloudflare Workers' Node TLS shim does not support the certificate
  // options node-postgres derives from sslmode/channel_binding URL options.
  // Keep this URI adjustment inside the Workerd runtime branch.
  // PostgreSQL requires verified TLS in this runtime.
  const connectionUrl=new URL(uri);
  const sslmode=connectionUrl.searchParams.get('sslmode');
  if(sslmode&&!['require','verify-ca','verify-full'].includes(sslmode.toLowerCase()))
    throw unavailable('LOC PostgreSQL requires verified TLS');
  connectionUrl.searchParams.delete('sslmode');
  // Workerd TLS sockets provide verified transport but cannot expose the
  // peer certificate to node-postgres for SCRAM-SHA-256-PLUS binding.
  // Neon URIs commonly request channel_binding=require. Using that libpq
  // option in this runtime can terminate the pg.Client connection despite
  // PostgreSQL having offered a valid SCRAM challenge. Fall back ONLY to
  // SCRAM-SHA-256 inside the already-verified TLS tunnel. Never disable TLS
  // or allow plaintext credentials.
  const binding=connectionUrl.searchParams.get('channel_binding');
  if(binding&&!['require','prefer','disable'].includes(binding.toLowerCase()))
    throw unavailable('Unsupported LOC PostgreSQL channel binding mode');
  connectionUrl.searchParams.delete('channel_binding');
  // Workerd requires request-owned sockets. A shared pg.Pool can reuse a
  // socket across request lifetimes, so use the request-scoped pool here.
  // PostgreSQL SSLRequest + verified TLS + startup alone takes ~1.2s at
  // the deployed edge. The previous 1500ms per-attempt limit killed pg.Client
  // during the *additional SCRAM authentication exchanges*, even though
  // its TCP, TLS and PostgreSQL startup were all healthy. Give the first
  // full authentication handshake up to 4s, while bounding cumulative
  // acquisition and avoiding any retry of an uncertain SQL statement.
  const pool=requestScopedPool({connectionString:connectionUrl.href,
    connectionTimeoutMillis:6000,ssl:true},pg.Client,{
    attempts:2,attemptTimeoutMs:4000,maxElapsedMs:6500,
    baseDelayMs:200,maxDelayMs:500
  });
  // Use Kysely's upstream dialect factory. LOC's selected primary remains
  // PostgreSQL today, while the same trusted boundary can compile MySQL or
  // SQL Server targets when their caller-supplied pool is enabled.
  const dialect=createKyselyDialect(primary.engine,{pool});
  const connection={db:new Kysely({dialect}),dialect,pool,
    engine:'postgres',namespace:primary.schema_name,tableName:'',fieldMap:{},
    connectionProvider:connectionRoute.provider,
    connectionMode:connectionRoute.connectionMode};
  return connection;
}
export {db_connection as directMcpKysely};

/** Close a trusted LOC request's SQL ownership once all work has settled.
 * db.destroy() owns Kysely's connection release; pool.end() also closes
 * connections acquired before Kysely could finish constructing a query.
 */
export async function closeLocDatabase(port){
  if(!port)return;
  // The Node/VPS pool belongs to this process, not to one Server Action.
  // Kysely releases each query connection normally; destroying this per-action
  // Kysely wrapper would otherwise close the shared pool for every request.
  if(port.sharedPool)return;
  try{await port.db?.destroy?.();}
  finally{await port.pool?.end?.();}
}
export function bindLocRequestAbort(port,signal){
  const cancel=port?.abort||port?.pool?.abort?.bind(port.pool);
  if(!signal||typeof cancel!=='function')return ()=>{};
  // An abort listener cannot be awaited by AbortSignal. The owning request
  // still closes resources in finally; never leak a rejected cleanup promise
  // as an unhandled rejection during a disconnected SQL request.
  const abort=()=>{
    try{void Promise.resolve(cancel()).catch(()=>{});}
    catch{/* The enclosing request handles the original query failure. */}
  };
  if(signal.aborted)abort();
  else signal.addEventListener('abort',abort,{once:true});
  return ()=>signal.removeEventListener('abort',abort);
}
