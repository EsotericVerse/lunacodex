// LOC's default control database is a server-owned Kysely Driver connection alias.
// Personal database selections are stored in LOC Auth and take effect without
// rebuilding or redeploying the website. No provider URL or credential lives here.
// MAIN DATABASE ONLY: choose the SQL type below before redeploying main.
// Supported SQL types: postgres, mysql (including MariaDB), mssql (T-SQL).
// Port is NEVER inferred. The private temporary main connection URL includes
// the actual hostname and explicitly selected port, which can be nonstandard.
// No connection URL, secret or token may be committed to this file.
// Other databases/projects are independent SSO-selected runtime targets.
export const DATABASE_ACCESS_LIST=Object.freeze([
  Object.freeze({
    target_id:'loc-main',label:'主要資料庫連線',provider:'custom',
    engine:'postgres',connection_alias:'loc_main',connection_mode:'direct',
    selected:true,backup_selected:false
  })
]);
export function databaseAccessTargets(){
  return DATABASE_ACCESS_LIST.map(entry=>({...entry}));
}
