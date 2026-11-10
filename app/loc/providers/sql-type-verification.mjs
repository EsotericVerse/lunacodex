// Verify, never discover, the SQL type explicitly selected by the connection
// owner. Exactly one read-only query is issued through that type's existing
// Kysely Dialect. No fallback Driver, port scan, or arbitrary SQL input.
import {sql} from 'kysely';

const SQL_TYPES=new Set(['postgres','mysql','mssql']);

export function assertSelectedSqlVersion(engine,version,vendor=''){
 if(!SQL_TYPES.has(engine))
  throw Object.assign(new Error('SQL Type must be explicitly selected'),
   {code:'SQL_TYPE_REQUIRED'});
 const text=String(version||''),edition=String(vendor||'');
 const matches=engine==='postgres'
  ? /^PostgreSQL\b/i.test(text)
  : engine==='mysql'
    ? /\b(?:mysql|mariadb|percona)\b/i.test(text+' '+edition)
      && /^\d+\.\d+/.test(text)
    : /\bMicrosoft SQL (?:Server|Azure)\b|\bAzure SQL\b/i.test(text);
 if(!matches)throw Object.assign(
  new Error('Server does not match the selected SQL Type'),
  {code:'SQL_TYPE_MISMATCH'});
 return {engine,version:text.slice(0,300)};
}

export async function verifySelectedSqlType(db,engine,{query}={}){
 if(!SQL_TYPES.has(engine))
  throw Object.assign(new Error('SQL Type must be explicitly selected'),
   {code:'SQL_TYPE_REQUIRED'});
 // These are fixed, read-only version statements, not discovery SQL.
 const read=query||(
  engine==='postgres'
   ?()=>sql`select version() as server_version`.execute(db)
   :engine==='mysql'
    ?()=>sql`select version() as server_version, @@version_comment as server_comment`.execute(db)
    :()=>sql`select @@version as server_version`.execute(db)
 );
 const response=await read();
 const row=response?.rows?.[0]||{};
 return assertSelectedSqlVersion(engine,row.server_version,row.server_comment);
}
