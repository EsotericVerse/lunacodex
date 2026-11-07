// First-party LOC SQL service. Reuse the same Kysely + LOC Authority gateway
// as the hosted compatibility entry; never fork SQL or authorization logic.
// A standalone host must not silently fall back to Supabase/Neon credentials.
const alias=String(Deno.env.get('LOC_CONTROL_DB_ALIAS')||'');
const engine=String(Deno.env.get('LOC_CONTROL_DB_ENGINE')||'');
if(!/^[a-z][a-z0-9_]{0,63}$/.test(alias)||
   !['postgres','mysql','mssql'].includes(engine))
  throw new Error('LOC standalone SQL control alias and engine are required');
let profiles:Record<string,{engine?:string,url?:string}>;
try{
  profiles=JSON.parse(Deno.env.get('LOC_DB_CONNECTIONS_JSON')||'{}');
}catch{throw new Error('Invalid LOC SQL connection configuration');}
if(!profiles||Array.isArray(profiles)||typeof profiles!=='object'||
   profiles[alias]?.engine!==engine||!profiles[alias]?.url)
  throw new Error('LOC SQL server connection alias is not configured');
await import('../../app/loc/gateway/sql-handler.ts');
