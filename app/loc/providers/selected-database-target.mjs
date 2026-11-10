// LOC database targets are provider-neutral: engine plus trusted SQL alias.
import {SQL_ENGINE_OPTIONS} from './sql-engine-ports.mjs';
export const DATABASE_ENGINES=Object.freeze(SQL_ENGINE_OPTIONS.map(entry=>entry.value));
export const DATABASE_PROVIDERS=Object.freeze(['custom','direct','supabase','neon']);
export const CONNECTION_MODES=Object.freeze(['direct','pooler']);
const aliasPattern=/^[a-z][a-z0-9_-]{0,63}$/;
const engines=new Set(DATABASE_ENGINES);
const providers=new Set(DATABASE_PROVIDERS);
const modes=new Set(CONNECTION_MODES);
export function normalizeDatabaseTarget(row){
  if(!row||typeof row!=='object'||Array.isArray(row))throw new Error('Invalid database target');
  const provider=String(row.provider||'custom');
  if(!providers.has(provider))throw new Error('Selected database provider is not supported');
  // SQL Type is explicitly selected in the connection profile, never inferred.
  const engine=String(row.engine||'');
  if(!engines.has(engine))throw new Error('Invalid database engine for provider');
  const alias=String(row.connection_alias||'');
  if(!aliasPattern.test(alias))throw new Error('Invalid server-side connection alias');
  const mode=String(row.connection_mode||'direct');
  if(!modes.has(mode))throw new Error('Invalid database connection mode');
  return {...row,provider,engine,connection_alias:alias,connection_mode:mode};
}
export function selectedDatabaseTarget(rows){
  if(!Array.isArray(rows))throw new Error('Database target configuration is invalid');
  const selected=rows.filter(row=>row?.selected===true);
  if(selected.length>1)throw new Error('More than one database target is selected');
  if(!selected.length)throw new Error('No SQL database target was explicitly selected');
  return normalizeDatabaseTarget(selected[0]);
}
export function selectedDatabaseProvider(rows,options){
  return selectedDatabaseTarget(rows,options).provider;
}
