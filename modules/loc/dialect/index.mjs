// loc:dialect — explicitly selected SQL Types.
// This registry selects Kysely Dialects only. It does not choose a network
// provider, construct a Driver pool, infer a URL protocol or manage credentials.
import {POSTGRES_SQL_TYPE,postgresDialectConstructor}
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
