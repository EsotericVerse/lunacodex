// loc:dialect — a database-driver entrypoint. No Galaxy, Scope, OAuth,
// database target discovery, credentials storage, or application-specific rules.
import {Kysely,MssqlDialect,MysqlDialect,PostgresDialect} from 'kysely';
import pg from 'pg';

export const KyselyDialectConstructors=Object.freeze({
  postgres:PostgresDialect,mysql:MysqlDialect,mssql:MssqlDialect
});

const REQUIRED_CONFIG=Object.freeze({
  postgres:Object.freeze(['pool']),
  mysql:Object.freeze(['pool']),
  mssql:Object.freeze(['tarn','tedious'])
});

export function createKyselyDialect(engine,config){
  const id=String(engine||''),Dialect=KyselyDialectConstructors[id];
  if(!Dialect)throw new Error('Unsupported Kysely SQL dialect');
  if(!config||typeof config!=='object'||Array.isArray(config))
    throw new TypeError('A trusted Kysely dialect configuration is required');
  const missing=REQUIRED_CONFIG[id].filter(key=>!Object.hasOwn(config,key)||config[key]==null);
  if(missing.length)throw new TypeError('Missing Kysely '+id+' dialect configuration: '+missing.join(','));
  return new Dialect(config);
}

// A pg.Client is acquired and released inside the same request. This also
// avoids reusing a Cloudflare request-owned socket in a later request.
// Kysely's own releaseConnection() never awaits what `client.release()`
// returns (it calls it fire-and-forget), so closing the socket cannot ride
// on that call. Cloudflare may freeze/reclaim the isolate the instant the
// HTTP response is sent, before an un-awaited close actually reaches
// PostgreSQL. Without a clean close, the server-side connection can sit
// open until Neon's own idle timeout reclaims it — under concurrent
// requests, these pile up faster than they are reclaimed and exhaust the
// connection ceiling, surfacing as unrelated-looking 503s elsewhere.
// `waitUntil` (from the Cloudflare request context) tells the platform to
// keep the isolate alive until the close actually finishes. The pool
// object can be reused across requests when the connection is cached by
// isolate (see db_connection()), so `setWaitUntil` lets each request
// update which `waitUntil` `release()` uses, instead of a stale one
// captured by whichever request first built this pool.
// Any serverless/pooled Postgres provider (Neon, Aurora Serverless v2, etc)
// can momentarily fail a brand-new connection: a suspended compute waking
// up, a pooler briefly out of free slots, a transient network blip. None of
// that is specific to whichever vendor is behind `url` today, so this is
// handled here, in the connection layer itself, instead of by tuning any
// one vendor's dashboard settings - the fix has to survive switching DBs.
// Retry the *connection*, never a SQL statement or an uncertain write.
// A cold-starting database may reject early attempts immediately. Bound the
// entire acquisition to six seconds so a 9-second browser read still has time
// to execute SQL and return a response. Socket cleanup remains mandatory.
const NON_RETRYABLE_CONNECTION_CODES=new Set([
  '28P01','28000','3D000','3F000','42501','ENOTFOUND'
]);
export function requestScopedPool(options,ClientClass=pg.Client,{
  attempts=7,baseDelayMs=350,maxDelayMs=1400,
  maxElapsedMs=6000,attemptTimeoutMs=1500,
  now=()=>Date.now(),
  sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
}={}){
  let currentWaitUntil=null;
  let ended=false;
  const acquired=new Set();
  const connecting=new Set();
  const closing=new Map();
  const closed=new WeakSet();
  function close(client){
    if(closing.has(client))return closing.get(client);
    if(closed.has(client))return Promise.resolve();
    closed.add(client);
    acquired.delete(client);
    connecting.delete(client);
    const task=Promise.resolve().then(()=>client.end?.()).catch(()=>{})
      .finally(()=>closing.delete(client));
    closing.set(client,task);
    return task;
  }
  function release(client){
    const task=close(client);
    // A response must not freeze a Cloudflare isolate while the PostgreSQL
    // socket remains open. The owning request also explicitly awaits end().
    if(currentWaitUntil)currentWaitUntil(task);
  }
  return {
    setWaitUntil(fn){currentWaitUntil=typeof fn==='function'?fn:null;},
    async connect(){
      if(ended)throw new Error('LOC request database connection already closed');
      let lastError;
      const started=now();
      for(let attempt=1;attempt<=attempts;attempt++){
        if(ended)throw new Error('LOC request database connection already closed');
        const remaining=maxElapsedMs-(now()-started);
        if(remaining<=0)break;
        // pg enforces this timeout per socket. A 6s timeout on EACH retry
        // would take up to 26.1s with the previous four-attempt backoff.
        const configured=Number(options?.connectionTimeoutMillis);
        const perAttempt=Number.isFinite(configured)&&configured>0
          ?Math.min(configured,attemptTimeoutMs):attemptTimeoutMs;
        const client=new ClientClass({...options,
          connectionTimeoutMillis:Math.max(1,Math.floor(Math.min(perAttempt,remaining)))
        });
        client.on?.('error',()=>{});
        connecting.add(client);
        try{
          await client.connect();
          connecting.delete(client);
          if(ended){
            await close(client);
            throw new Error('LOC request database connection already closed');
          }
          acquired.add(client);
          client.release=()=>release(client);
          return client;
        }catch(error){
          connecting.delete(client);
          lastError=error;
          // A failed connection attempt still owns a partially opened socket.
          // Wait for its close before retrying or returning an error.
          await close(client);
          if(ended)throw error;
          // Invalid credentials, database names and SQL permissions cannot
          // be fixed by waking the compute; surface them without retrying.
          if(NON_RETRYABLE_CONNECTION_CODES.has(String(error?.code||'')))
            throw error;
          if(attempt<attempts){
            const left=maxElapsedMs-(now()-started);
            const delay=Math.min(maxDelayMs,baseDelayMs*2**(attempt-1),left);
            if(delay>0)await sleep(delay);
          }
        }
      }
      throw lastError||new Error('LOC database connection retry budget exhausted');
    },
    async end(){
      ended=true;
      await Promise.all([
        ...[...acquired,...connecting].map(close),
        ...closing.values()
      ]);
      currentWaitUntil=null;
    },
    // A cancelled request must release its socket even when its page cannot
    // finish drawing or its SQL callback never reached a normal COMMIT.
    async abort(){await this.end();}
  };
}

/** Server-only public contract: const db = dialect('pg', trustedUrl).
 * Returns a Kysely instance. The caller owns db.destroy() and permissions.
 * The URL stays in memory and is never logged or exported.
 */
export function dialect(driver,url){
  if(driver!=='pg')
    throw new Error('Unsupported SQL driver');
  if(typeof url!=='string'||!url.trim())
    throw new TypeError('A database URL is required');
  let parsed;
  try{parsed=new URL(url)}catch{throw new TypeError('Invalid database URL')}
  if(!['postgres:','postgresql:'].includes(parsed.protocol)||!parsed.hostname)
    throw new TypeError('Expected a PostgreSQL URL');
  // The pool bounds each connection attempt to 1.5s and its cumulative
  // retry budget to 6s. This option remains an upper bound for other callers.
  const pool=requestScopedPool({
    connectionString:url,connectionTimeoutMillis:6000
  });
  return new Kysely({dialect:createKyselyDialect('postgres',{pool})});
}

export default dialect;
