import {sql} from "npm:kysely@0.29.8";
import {normalizeDatabaseLocation} from "../../../app/loc/providers/database-link.mjs";

const ALIAS=/^[a-z][a-z0-9_]{0,63}$/;
function vaultName(alias:string){if(!ALIAS.test(alias))throw new Error("Invalid alias");return "loc_db_"+alias;}
function bad(message:string):never{throw Object.assign(new Error(message),{httpStatus:400});}
export function makeConnectionProfile(raw:Record<string,unknown>,password:string){
  const provider=String(raw.provider);
  const engine=String(raw.engine||"postgres");
  const location=normalizeDatabaseLocation(provider,raw.project_url);
  const username=String(raw.username||"").trim();
  const database=String(raw.database||"").trim();
  if(!username||!database||!password)bad("Database username, database and password are required");
  if(username.length>160||database.length>160||password.length>1024)bad("Database credentials exceed allowed length");
  const region=String(raw.region||"").trim();
  let host:string;let port:number;let user=username;
  if(provider==="supabase"){
    const projectRef=location.projectId;
    if(String(raw.connection_mode||"pooler")==="pooler"){
      if(!/^[a-z]{2}-[a-z]+-\d$/.test(region))bad("Supabase pooler requires a valid Region");
      host="aws-0-"+region+".pooler.supabase.com";port=6543;
      if(!username.includes("."))user=username+"."+projectRef;
    }else{host="db."+projectRef+".supabase.co";port=5432}
  }else if(provider==="neon"){host=location.host;port=5432}
  else{host=location.host;port=location.port||({postgres:5432,mysql:3306,mssql:1433}[engine]||0)}
  if(!host||!port)bad("Invalid SQL destination");
  const protocol={postgres:"postgresql:",mysql:"mysql:",mssql:"mssql:"}[engine];
  if(!protocol)bad("This SQL driver requires a supported persistent runtime");
  const url=protocol+"//"+encodeURIComponent(user)+":"+encodeURIComponent(password)+"@"+host+":"+port+"/"+encodeURIComponent(database);
  return {engine,url,link:location.link,region,tls:true};
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
export async function saveVaultConnection(trx:any,alias:string,profile:Record<string,unknown>){
  const name=vaultName(alias);
  const existing=await sql<{id:string}>`select id from vault.secrets where name=${name} limit 1`.execute(trx);
  const value=JSON.stringify(profile);
  if(existing.rows[0]){
    await sql`select vault.update_secret(${existing.rows[0].id}::uuid,${value},${name},'LOC database connection',null::uuid)`.execute(trx);
  }else{
    await sql`select vault.create_secret(${value},${name},'LOC database connection',null::uuid)`.execute(trx);
  }
}
