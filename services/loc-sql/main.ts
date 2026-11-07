import {prepareLocSqlEdgeRuntime} from '../../app/loc/gateway/edge-runtime-compat.mjs';

// First-party LOC SQL service. Reuse the same Kysely + LOC Authority gateway
// as the hosted compatibility entry; never fork SQL or authorization logic.
// A standalone host must not silently fall back to Supabase/Neon credentials.
const alias=String(Deno.env.get('LOC_CONTROL_DB_ALIAS')||'');
const engine=String(Deno.env.get('LOC_CONTROL_DB_ENGINE')||'');
if(!/^[a-z][a-z0-9_-]{0,63}$/.test(alias)||
   !['postgres','mysql','mssql'].includes(engine))
  throw new Error('LOC standalone SQL control alias and engine are required');
let profiles:Record<string,{engine?:string,url?:string}>;
try{
  profiles=JSON.parse(Deno.env.get('LOC_DB_CONNECTIONS_JSON')||'{}');
}catch{throw new Error('Invalid LOC SQL connection configuration');}
if(!profiles||Array.isArray(profiles)||typeof profiles!=='object')
  throw new Error('LOC SQL server connections are invalid');
// A user-selected database can come from Authority at request time, but a
// guest and the LOC control plane still need the server-owned default alias.
// Authority's optional service credential cannot replace that connection.
const base=Object.hasOwn(profiles,alias)?profiles[alias]:null;
if(!base||typeof base!=='object'||Array.isArray(base)||
   base.engine!==engine||typeof base.url!=='string'||!base.url.trim())
  throw new Error('LOC SQL control alias needs a trusted database profile in LOC_DB_CONNECTIONS_JSON');
// The live database selected by a verified user is resolved from Authority on
// each request. A one-time Gateway deployment can serve every trusted SQL
// engine afterward without editing these deployment variables.
prepareLocSqlEdgeRuntime();
await import('../../app/loc/gateway/sql-handler.ts');
