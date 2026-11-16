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
          if(attempt<attempts)
            await new Promise(resolve=>setTimeout(resolve,delayMs));
        }
      }
      throw lastError;
    },
    async end(){}
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
  const pool=requestScopedPool({
    connectionString:url,connectionTimeoutMillis:3500
  });
  return new Kysely({dialect:createKyselyDialect('postgres',{pool})});
}

export default dialect;
