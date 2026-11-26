// PostgreSQL SQL Type. Selected explicitly by a trusted engine='postgres'.
// No detection, alternate-database probing or fallback to a different driver.
import {PostgresDialect,sql} from 'kysely';
import Cursor from 'pg-cursor';

export const POSTGRES_SQL_TYPE=Object.freeze({
  id:'postgres',label:'PostgreSQL',dialect:'PostgresDialect',driver:'pg',
  runtime:'node',namespace:'schema',session:'external-acl',schema:'kysely',
  requiredConfig:Object.freeze(['pool']),protocol:'postgres',
  defaultNamespace:'public',nativeConnection:true,returning:true,
  insertParameterLimit:32000,insertMaxRows:10000,
  upsertParameterLimit:32000,upsertMaxRows:10000,
  maxBatchBytes:512*1024,streamChunkRows:256,streamStrategy:'pg-cursor'
});

export const postgresCursorConstructor=Cursor;
export function postgresDialectConfig(config){
  if(!config||typeof config!=='object'||Array.isArray(config))
    throw new TypeError('A PostgreSQL dialect configuration is required');
  return {...config,cursor:config.cursor??Cursor};
}
export class LocPostgresDialect extends PostgresDialect{
  constructor(config){super(postgresDialectConfig(config));}
}
export const postgresDialectConstructor=LocPostgresDialect;

export function postgresNativeUpsert(insert,req,updateColumns){
  return insert.onConflict(oc=>updateColumns.length&&!req.ignoreDuplicates
    ?oc.columns(req.onConflict).doUpdateSet(eb=>Object.fromEntries(
      updateColumns.map(col=>[col,eb.ref('excluded.'+col)])))
    :oc.columns(req.onConflict).doNothing());
}
export function postgresMutationReturning(query,req){
  return req.returning?query.returning(req.columns):query;
}
export function postgresContainsPredicate(column,pattern,fold){
  return fold
    ?sql`${sql.ref(column)} ilike ${pattern} escape '!'`
    :sql`${sql.ref(column)} like ${pattern} escape '!'`;
}
