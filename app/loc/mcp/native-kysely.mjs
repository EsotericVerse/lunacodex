// The LOC business backend opens its own PostgreSQL connection.
// It never asks LOC Auth for database credentials, profiles, targets or SQL.
import {Kysely,PostgresDialect} from 'kysely';
import pg from 'pg';
import {DATABASE_ACCESS_LIST} from '../providers/access.js';

const pools=new WeakMap();
const primary=DATABASE_ACCESS_LIST.find(row=>row.selected===true);
function unavailable(message){
  return Object.assign(new Error(message),{code:'BACKEND_UNAVAILABLE',httpStatus:503});
}
function mainUri(env){
  const value=String(env?.LOC_DATABASE_URI||'').trim();
  if(!value)throw unavailable('LOC primary PostgreSQL connection missing');
  let url;
  try{url=new URL(value)}catch{throw unavailable('LOC primary PostgreSQL URI malformed')}
  if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname||
     !url.username||!url.password||url.pathname.length<=1)
    throw unavailable('LOC primary PostgreSQL URI incomplete');
  return value;
}
export function mcpDatabaseConfiguration(env={}){
  const configured=Boolean(String(env?.LOC_DATABASE_URI||'').trim());
  return {publicReadConfigured:configured,privateReadConfigured:configured,
    privateWriteConfigured:configured,verification:'configuration-only'};
}
export async function db_connection(env={},verifiedAlias='',{probeTicket=''}={}){
  if(!env||typeof env!=='object')throw unavailable('LOC backend environment missing');
  // A caller's string can never select a different SQL target. LOC currently
  // uses one production Neon PostgreSQL database for its business data.
  if(verifiedAlias&&verifiedAlias!==primary?.target_id&&
     verifiedAlias!==primary?.connection_alias)
    throw unavailable('Additional database connection not configured');
  if(probeTicket)throw unavailable('Manual probe is not a business SQL operation');
  const uri=mainUri(env);
  let record=pools.get(env);
  if(record?.uri===uri)return record.connection;
  const pool=new pg.Pool({connectionString:uri,max:3,
    idleTimeoutMillis:12000,connectionTimeoutMillis:7000,
    ssl:{rejectUnauthorized:true}});
  const dialect=new PostgresDialect({pool});
  const connection={db:new Kysely({dialect}),dialect,
    engine:'postgres',namespace:'silver',tableName:'',fieldMap:{}};
  record={uri,connection};
  pools.set(env,record);
  return connection;
}
export {db_connection as directMcpKysely};
