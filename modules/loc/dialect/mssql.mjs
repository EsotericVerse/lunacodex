// SQL Server / T-SQL Type. Selected only when the trusted engine='mssql'.
// Never translate a failed PostgreSQL/MySQL statement by guessing SQL type.
import {MssqlDialect,sql} from 'kysely';

export const MSSQL_SQL_TYPE=Object.freeze({
  id:'mssql',label:'SQL Server',dialect:'MssqlDialect',driver:'tedious',
  runtime:'node',namespace:'schema',session:'external-acl',schema:'kysely',
  requiredConfig:Object.freeze(['tarn','tedious']),protocol:'mssql',
  defaultNamespace:'dbo',nativeConnection:false,returning:true,
  insertParameterLimit:2000,insertMaxRows:50,upsertParameterLimit:1900
});
export const mssqlDialectConstructor=MssqlDialect;

export function mssqlMutationReturning(query,req){
  if(!req.returning)return query;
  const prefix=req.operation==='delete'?'deleted':'inserted';
  return req.columns.length===1&&req.columns[0]==='*'
    ?query.outputAll(prefix)
    :query.output(req.columns.map(col=>prefix+'.'+col));
}
export function mssqlCheckPagination(req){
  if(req.offset>0&&!req.orders.length)
    throw new Error('SQL Server pagination requires an explicit order');
}
export async function mssqlLockPrimaryKey(trx,table,primary,row){
  const conditions=primary.map(column=>sql`${sql.ref(column)} = ${row[column]}`);
  // UPDLOCK + HOLDLOCK keeps the PK key range locked until the surrounding
  // Kysely transaction commits. It is intentionally not a MERGE statement.
  const result=await sql`
    select ${sql.join(primary.map(column=>sql.ref(column)),sql`, `)}
    from ${sql.ref(table)} with (updlock,holdlock)
    where ${sql.join(conditions,sql` and `)}
  `.execute(trx);
  return result.rows;
}
