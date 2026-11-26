// MySQL SQL Type. The trusted profile MUST say engine='mysql'.
// LOC never infers a SQL dialect from URLs, tables or failed statements.
import {MysqlDialect,sql} from 'kysely';

export const MYSQL_SQL_TYPE=Object.freeze({
  id:'mysql',label:'MySQL',dialect:'MysqlDialect',driver:'mysql2',
  runtime:'node',namespace:'database',session:'external-acl',schema:'kysely',
  requiredConfig:Object.freeze(['pool']),protocol:'mysql',
  defaultNamespace:'',nativeConnection:false,returning:false,
  insertParameterLimit:32000,insertMaxRows:1000,
  upsertParameterLimit:32000,upsertMaxRows:1000,
  maxBatchBytes:512*1024,streamChunkRows:1,streamStrategy:'mysql2-readable-row'
});
export const mysqlDialectConstructor=MysqlDialect;

export function mysqlMutationReturning(query,req){
  if(req.returning)
    throw new Error('MySQL has no equivalent native INSERT/UPDATE/DELETE RETURNING');
  return query;
}
export async function mysqlLockPrimaryKeys(trx,table,primary,rows,extraColumns=[]){
  if(!Array.isArray(rows)||!rows.length)return [];
  const selected=[...new Set([...primary,...extraColumns])];
  const conditions=rows.map(row=>sql`(${sql.join(
    primary.map(column=>sql`${sql.ref(column)} = ${row[column]}`),sql` and `
  )})`);
  const result=await sql`
    select ${sql.join(selected.map(column=>sql.ref(column)),sql`, `)}
    from ${sql.ref(table)}
    where ${sql.join(conditions,sql` or `)}
    order by ${sql.join(primary.map(column=>sql.ref(column)),sql`, `)}
    for update
  `.execute(trx);
  return result.rows;
}
export async function mysqlLockPrimaryKey(trx,table,primary,row,extraColumns=[]){
  return mysqlLockPrimaryKeys(trx,table,primary,[row],extraColumns);
}
