// MySQL SQL Type. The trusted profile MUST say engine='mysql'.
// LOC never infers a SQL dialect from URLs, tables or failed statements.
import {MysqlDialect,sql} from 'kysely';

export const MYSQL_SQL_TYPE=Object.freeze({
  id:'mysql',label:'MySQL',dialect:'MysqlDialect',driver:'mysql2',
  runtime:'node',namespace:'database',session:'external-acl',schema:'kysely',
  requiredConfig:Object.freeze(['pool']),protocol:'mysql',
  defaultNamespace:'',targetNamespace:'',nativeConnection:false,returning:false,
  insertParameterLimit:32000,insertMaxRows:50,upsertParameterLimit:32000
});
export const mysqlDialectConstructor=MysqlDialect;

// This compiler is kept for explicit native-SQL usage. The authenticated
// LOC managed path uses mysqlLockPrimaryKey instead, because MySQL's ON
// DUPLICATE KEY UPDATE also matches other unique indexes.
export function mysqlNativeUpsert(insert,req,updateColumns){
  if(req.ignoreDuplicates||!updateColumns.length)
    throw new Error('MySQL conflict-ignore is not equivalent to a targeted UPSERT');
  return insert.onDuplicateKeyUpdate(Object.fromEntries(
    updateColumns.map(col=>[col,sql`values(${sql.ref(col)})`])));
}
export function mysqlMutationReturning(query,req){
  if(req.returning)
    throw new Error('MySQL has no equivalent native INSERT/UPDATE/DELETE RETURNING');
  return query;
}
export async function mysqlLockPrimaryKey(trx,table,primary,row){
  let lookup=trx.selectFrom(table).select(primary);
  for(const column of primary)lookup=lookup.where(column,'=',row[column]);
  return lookup.forUpdate().execute();
}
