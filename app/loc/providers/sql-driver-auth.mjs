// LOC OAuth/Scope grants remain entirely separate from database logins.
// A trusted external profile may select PostgreSQL, MySQL or SQL Server;
// only explicit username/password authentication is accepted at this stage.
// Windows integrated login, IAM and unverified passwordless schemes remain
// rejected rather than silently disabling the database credential boundary.
const SQL_ENGINES=new Set(['postgres','mysql','mssql']);
export function sqlAuthNeedsUserPassword(authentication={type:'default'}){
  return authentication?.type==='default';
}
export function normalizeSqlDriverAuthentication(engine,input){
  if(!SQL_ENGINES.has(engine))
    throw Error('Unsupported SQL driver authentication for engine');
  const source=input===undefined?{type:'default'}:input;
  if(!source||typeof source!=='object'||Array.isArray(source))
    throw Error('Invalid SQL driver authentication configuration');
  if(source.type!==undefined&&source.type!=='default')
    throw Error('Unsupported SQL driver authentication for engine');
  if(Object.keys(source).some(key=>key!=='type'))
    throw Error('Unexpected SQL driver authentication field');
  return {type:'default'};
}
export function publicSqlDriverAuthentication(){return {type:'default'};}
