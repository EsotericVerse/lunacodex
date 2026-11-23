// loc:dialect — explicitly selected SQL Types. No type inference, fallback,
// Galaxy, Scope, OAuth, target discovery or credential storage.
import {Kysely} from 'kysely';
import pg from 'pg';
import {POSTGRES_SQL_TYPE,postgresDialectConstructor,requestScopedPostgresPool}
  from './postgres.mjs';
import {MYSQL_SQL_TYPE,mysqlDialectConstructor} from './mysql.mjs';
import {MSSQL_SQL_TYPE,mssqlDialectConstructor} from './mssql.mjs';

// The caller's verified configuration MUST supply one of these three IDs.
export const SQL_TYPES=Object.freeze([
  POSTGRES_SQL_TYPE,MYSQL_SQL_TYPE,MSSQL_SQL_TYPE
]);
const types=new Map(SQL_TYPES.map(type=>[type.id,type]));
export function getSqlType(engine){
  const type=types.get(engine);
  if(!type)throw new Error('Unsupported Kysely SQL dialect');
  return type;
}
export const KyselyDialectConstructors=Object.freeze({
  postgres:postgresDialectConstructor,
  mysql:mysqlDialectConstructor,
  mssql:mssqlDialectConstructor
});
export function createKyselyDialect(engine,config){
  const type=getSqlType(engine);
  if(!config||typeof config!=='object'||Array.isArray(config))
    throw new TypeError('A trusted Kysely dialect configuration is required');
  const missing=type.requiredConfig.filter(key=>
    !Object.hasOwn(config,key)||config[key]==null);
  if(missing.length)throw new TypeError(
    'Missing Kysely '+type.id+' dialect configuration: '+missing.join(','));
  return new KyselyDialectConstructors[type.id](config);
}

// PostgreSQL's request-owned socket implementation stays in its SQL Type.
// Preserve the existing LOC import contract, including injectable test Client.
export function requestScopedPool(options,ClientClass=pg.Client,config){
  return requestScopedPostgresPool(options,ClientClass,config);
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
