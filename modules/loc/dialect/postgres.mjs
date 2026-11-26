// PostgreSQL SQL Type. Selected explicitly by a trusted engine='postgres'.
// No detection, alternate-database probing or fallback to a different driver.
import {PostgresDialect} from 'kysely';

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
