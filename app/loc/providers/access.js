// LOC's default control database is identified by a trusted SQL Gateway alias.
// Personal database selections are stored in LOC Auth and take effect without
// rebuilding or redeploying the website. No provider URL or credential lives here.
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
