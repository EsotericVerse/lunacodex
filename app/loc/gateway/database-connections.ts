import {sql} from "npm:kysely@0.29.8";
import {normalizeDatabaseLocation} from "../providers/database-link.mjs";

const ALIAS=/^[a-z][a-z0-9_]{0,63}$/;
function vaultName(alias:string){if(!ALIAS.test(alias))throw new Error("Invalid alias");return "loc_db_"+alias;}
function bad(message:string):never{throw Object.assign(new Error(message),{httpStatus:400});}
export function makeConnectionProfile(raw:Record<string,unknown>,password:string){
  const provider=String(raw.provider);
  const engine=String(raw.engine||"postgres");
  const location=normalizeDatabaseLocation(provider,raw.project_url);
  const username=String(raw.username||"").trim();
  const database=String(raw.database||"").trim();
  const direct=String(raw.connection_url||'').trim();
  if(!password||!direct&&(!username||!database))
    bad("Database URL and control token, or user/database/password, are required");
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
  // A complete SQL URL plus a separate token is a private driver profile.
  // The URL and token never belong in the public LOC registry JSON.
  let url:string;
  if(direct){
    let parsed:URL;
    try{parsed=new URL(direct)}catch{bad("Invalid SQL connection URL")}
    const compatible=engine==='postgres'
      ?['postgres:','postgresql:']
      :engine==='mssql'?['mssql:','sqlserver:']:[protocol];
    if(!parsed||!compatible.includes(parsed.protocol)||!parsed.hostname||parsed.password||
       parsed.search||parsed.hash)bad("SQL URL needs a valid host and no embedded secret");
    if(!parsed.pathname||parsed.pathname==='/')bad("SQL URL needs a database name");
    if(!parsed.username&&!(engine==='mssql'&&
       raw.auth_type==='azure-active-directory-access-token'))
      bad("SQL URL needs a user name");
    parsed.password=password;
    url=parsed.toString();
  }else{
    url=protocol+"//"+encodeURIComponent(user)+":"+encodeURIComponent(password)+"@"+host+":"+port+"/"+encodeURIComponent(database);
  }
  const type=String(raw.auth_type||'default');
  if(!['default','ldap-simple','ntlm','azure-active-directory-access-token',
    'azure-active-directory-default','azure-active-directory-password',
    'azure-active-directory-msi-vm','azure-active-directory-msi-app-service',
    'azure-active-directory-service-principal-secret'].includes(type))
    bad("Unsupported SQL authentication");
  const authentication=type==='default'?undefined:{type,
    ...(raw.domain?{domain:String(raw.domain)}:{}),
    ...(raw.client_id?{clientId:String(raw.client_id)}:{}),
    ...(raw.tenant_id?{tenantId:String(raw.tenant_id)}:{})};
  return {engine,url,link:location.link,region,tls:true,authentication};
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
