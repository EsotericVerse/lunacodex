// LOC database target registry. Engine and hosting vendor are separate concerns.
import {SQL_ENGINE_OPTIONS,getSqlEnginePort} from './sql-engine-ports.mjs';
export const DATABASE_ENGINES=Object.freeze(SQL_ENGINE_OPTIONS.map(entry=>entry.value));
export const DATABASE_PROVIDERS=Object.freeze(['supabase','neon','custom']);
export const CONNECTION_MODES=Object.freeze(['direct','pooler']);
const aliasPattern=/^[a-z][a-z0-9_-]{0,63}$/;
const engines=new Set(DATABASE_ENGINES);
const providers=new Set(DATABASE_PROVIDERS);
const modes=new Set(CONNECTION_MODES);
export function normalizeDatabaseTarget(row){
  if(!row||typeof row!=='object'||Array.isArray(row))throw new Error('Invalid database target');
  const provider=String(row.provider||'');
  if(!providers.has(provider))throw new Error('Selected database provider is not supported');
  const engine=String(row.engine||'postgres');
  if(!engines.has(engine)||(provider!=='custom'&&engine!=='postgres'))throw new Error('Invalid database engine for provider');
  const alias=String(row.connection_alias||(provider==='supabase'?'supabase_current':provider==='neon'?'neon_current':''));
  if(!aliasPattern.test(alias))throw new Error('Invalid server-side connection alias');
  const mode=String(row.connection_mode||(provider==='supabase'?'pooler':'direct'));
  if(!modes.has(mode))throw new Error('Invalid database connection mode');
  // SQLite is supported in portable/local Kysely, not as an ephemeral Edge database.
  if(getSqlEnginePort(engine).runtime==='persistent-gateway')throw new Error('SQLite requires a persistent trusted local/gateway runtime');
  return {...row,provider,engine,connection_alias:alias,connection_mode:mode};
}
export function selectedDatabaseTarget(rows,{fallback='supabase'}={}){
  if(!Array.isArray(rows))throw new Error('Database target configuration is invalid');
  const selected=rows.filter(row=>row?.selected===true);
  if(selected.length>1)throw new Error('More than one database target is selected');
  return normalizeDatabaseTarget(selected[0]||{provider:fallback,engine:'postgres',selected:true});
}
export function selectedDatabaseProvider(rows,options){
  return selectedDatabaseTarget(rows,options).provider;
}
