// Kysely's upstream dialect implementations are the only SQL compiler and
// adapter layer used by LOC. The caller owns the trusted driver configuration
// (pool for PostgreSQL/MySQL, tarn+tedious for SQL Server); this module only
// selects the already-installed Kysely dialect class and never installs,
// imports, or discovers a vendor driver package.
import {MssqlDialect,MysqlDialect,PostgresDialect} from 'kysely';

const DIALECTS=Object.freeze({
  postgres:PostgresDialect,
  mysql:MysqlDialect,
  mssql:MssqlDialect
});

export const KyselyDialectConstructors=DIALECTS;

const REQUIRED_CONFIG=Object.freeze({
  postgres:Object.freeze(['pool']),
  mysql:Object.freeze(['pool']),
  // Kysely's upstream SQL Server port uses tarn + tedious rather than a
  // mysql-style pool option.  Keep that mature adapter contract intact.
  mssql:Object.freeze(['tarn','tedious'])
});

export function createKyselyDialect(engine,config){
  const id=String(engine||''),Dialect=DIALECTS[id];
  if(!Dialect)throw new Error('Unsupported Kysely SQL dialect');
  if(!config||typeof config!=='object'||Array.isArray(config))
    throw new TypeError('A trusted Kysely dialect configuration is required');
  const missing=REQUIRED_CONFIG[id].filter(key=>!Object.hasOwn(config,key)||config[key]==null);
  if(missing.length)throw new TypeError('Missing Kysely '+id+' dialect configuration: '+missing.join(','));
  return new Dialect(config);
}
