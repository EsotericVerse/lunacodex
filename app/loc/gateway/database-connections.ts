// Legacy Supabase control-plane compatibility: read an existing saved SQL
// profile only. No database-side Vault writes, migrations or RPC creation.
import {sql} from "npm:kysely@0.29.8";
const ALIAS=/^[a-z][a-z0-9_]{0,63}$/;
function vaultName(alias:string){
  if(!ALIAS.test(alias))throw new Error("Invalid alias");
  return "loc_db_"+alias;
}
export async function readVaultConnection(controlDb:any,target:Record<string,unknown>){
  const name=vaultName(String(target.connection_alias||""));
  const result=await sql<{decrypted_secret:string}>`select decrypted_secret from vault.decrypted_secrets where name=${name} limit 1`.execute(controlDb);
  const raw=result.rows[0]?.decrypted_secret;
  if(!raw)return null;
  let config;
  try{config=JSON.parse(raw)}catch{throw new Error("Stored database connection is invalid")}
  if(config.engine!==target.engine||config.link!==target.project_url||typeof config.url!=="string")throw new Error("Connection Link does not match saved credentials");
  return config;
}
