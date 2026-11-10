// Verify the selected PostgreSQL type through its existing Kysely connection.
// Exactly one fixed, read-only query. No discovery or alternative driver.
import {sql} from 'kysely';
const SQL_TYPES=new Set(['postgres']);
export function assertSelectedSqlVersion(engine,version){
 if(!SQL_TYPES.has(engine))
  throw Object.assign(new Error('SQL Type must be explicitly selected'),
   {code:'SQL_TYPE_REQUIRED'});
 const text=String(version||'');
 if(!/^PostgreSQL\\b/i.test(text))throw Object.assign(
  new Error('Server does not match the selected SQL Type'),
  {code:'SQL_TYPE_MISMATCH'});
 return {engine,version:text.slice(0,300)};
}
export async function verifySelectedSqlType(db,engine,{query}={}){
 if(!SQL_TYPES.has(engine))
  throw Object.assign(new Error('SQL Type must be explicitly selected'),
   {code:'SQL_TYPE_REQUIRED'});
 const read=query||(()=>sql`select version() as server_version`.execute(db));
 const response=await read();
 return assertSelectedSqlVersion(engine,response?.rows?.[0]?.server_version);
}
