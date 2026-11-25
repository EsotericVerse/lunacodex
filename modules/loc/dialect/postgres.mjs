// PostgreSQL SQL Type. Selected explicitly by a trusted engine='postgres'.
// No detection, alternate-database probing or fallback to a different driver.
import {PostgresDialect} from 'kysely';
import {SQL_WORKLOAD_POLICY} from './sql-workload-policy.mjs';

export const POSTGRES_SQL_TYPE=Object.freeze({
  id:'postgres',label:'PostgreSQL',dialect:'PostgresDialect',driver:'pg',
  runtime:'node',namespace:'schema',session:'external-acl',schema:'kysely',
  requiredConfig:Object.freeze(['pool']),protocol:'postgres',
  defaultNamespace:'public',nativeConnection:true,returning:true,
  insertParameterLimit:32000,insertMaxRows:10000,upsertParameterLimit:32000
});
export const postgresDialectConstructor=PostgresDialect;

export function postgresNativeUpsert(insert,req,updateColumns){
  return insert.onConflict(oc=>updateColumns.length&&!req.ignoreDuplicates
    ?oc.columns(req.onConflict).doUpdateSet(eb=>Object.fromEntries(
      updateColumns.map(col=>[col,eb.ref('excluded.'+col)])))
    :oc.columns(req.onConflict).doNothing());
}
export function postgresMutationReturning(query,req){
  return req.returning?query.returning(req.columns):query;
}

// PostgreSQL clients belong to one request-owned Kysely pool. Kysely releases
// a client after each statement, so keep released clients idle and reusable
// within that same request. Close every socket when the action's finally block
// destroys the Kysely instance; never carry a socket into another Worker request.
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
// Bound only one action's parallel SQL work. Do not share a semaphore between
// Worker requests: an unrelated slow feature must not queue homepage reads.
function dispatchRequestConnections(pool){
  while(!pool.ended&&pool.waiters.length){
    const waiter=pool.waiters[0];
    let client=null;
    while(pool.idle.length&&!client){
      const candidate=pool.idle.pop();
      if(pool.clients.has(candidate)&&!pool.closed.has(candidate))client=candidate;
    }
    if(client){
      pool.waiters.shift();
      pool.leased.add(client);
      waiter.resolve(client);
      continue;
    }
    if(pool.active<SQL_WORKLOAD_POLICY.workerRequestMaxConnections){
      pool.waiters.shift();
      pool.active++;
      waiter.resolve(null);
      continue;
    }
    break;
  }
}
function acquireRequestConnection(pool){
  if(pool.ended)return Promise.reject(
    new Error('LOC request database connection already closed'));
  if(!pool.waiters.length){
    let client=null;
    while(pool.idle.length&&!client){
      const candidate=pool.idle.pop();
      if(pool.clients.has(candidate)&&!pool.closed.has(candidate))client=candidate;
    }
    if(client){pool.leased.add(client);return Promise.resolve(client);}
  }
  if(!pool.waiters.length&&
      pool.active<SQL_WORKLOAD_POLICY.workerRequestMaxConnections){
    pool.active++;
    return Promise.resolve(null);
  }
  return new Promise((resolve,reject)=>{
    pool.waiters.push({resolve,reject});
    dispatchRequestConnections(pool);
  });
}
export function requestScopedPostgresPool(options,ClientClass,{
  attempts=7,baseDelayMs=350,maxDelayMs=1400,
  maxElapsedMs=6000,attemptTimeoutMs=1500,
  now=()=>Date.now(),
  sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
}={}){
  let ended=false;
  const closed=new WeakSet();
  const poolState={active:0,ended:false,waiters:[],idle:[],clients:new Set(),
    leased:new Set(),closed};
  const acquired=poolState.clients;
  const connecting=new Set();
  const closing=new Map();
  function close(client){
    if(closing.has(client))return closing.get(client);
    if(closed.has(client))return Promise.resolve();
    closed.add(client);
    const wasAcquired=acquired.delete(client);
    poolState.leased.delete(client);
    poolState.idle=poolState.idle.filter(item=>item!==client);
    connecting.delete(client);
    const task=Promise.resolve().then(()=>client.end?.()).catch(()=>{})
      .finally(()=>{
        closing.delete(client);
        if(wasAcquired&&poolState.active>0)poolState.active--;
        dispatchRequestConnections(poolState);
      });
    closing.set(client,task);
    return task;
  }
  function release(client){
    if(!poolState.leased.delete(client))return;
    if(ended){void close(client);return;}
    poolState.idle.push(client);
    dispatchRequestConnections(poolState);
  }
  return {
    setWaitUntil(){},
    async connect(){
      if(ended)throw new Error('LOC request database connection already closed');
      const reused=await acquireRequestConnection(poolState);
      if(reused)return reused;
      let clientOwnsPermit=false;
      let lastError;
      const started=now();
      try{for(let attempt=1;attempt<=attempts;attempt++){
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
        client.on?.('error',()=>{void close(client);});
        connecting.add(client);
        try{
          await client.connect();
          connecting.delete(client);
          if(ended){
            await close(client);
            throw new Error('LOC request database connection already closed');
          }
          acquired.add(client);
          poolState.leased.add(client);
          clientOwnsPermit=true;
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
      }finally{
        // A successful client owns its pool slot until request cleanup.
        if(!clientOwnsPermit){
          if(poolState.active>0)poolState.active--;
          dispatchRequestConnections(poolState);
        }
      }
    },
    async end(){
      ended=true;
      poolState.ended=true;
      for(const waiter of poolState.waiters.splice(0))
        waiter.reject(new Error('LOC request database connection already closed'));
      await Promise.all([
        ...[...acquired,...connecting].map(close),
        ...closing.values()
      ]);
    },
    // A cancelled request must release its socket even when its page cannot
    // finish drawing or its SQL callback never reached a normal COMMIT.
    async abort(){await this.end();}
  };
}

