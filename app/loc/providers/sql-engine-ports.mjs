// Single source of truth for the LOC SQL engine plug-in points.
// Kysely provides dialect-specific SQL generation; connection and security
// adapters remain on the trusted runtime (never in the browser).
const ENGINE_DEFINITIONS=[
  {id:'postgres',label:'PostgreSQL',dialect:'PostgresDialect',driver:'pg',runtime:'edge',namespace:'schema',session:'postgres-rls',schema:'kysely'},
  {id:'mysql',label:'MySQL / MariaDB',dialect:'MysqlDialect',driver:'mysql2',runtime:'edge',namespace:'database',session:'external-acl',schema:'kysely'},
  {id:'mssql',label:'SQL Server / Azure SQL',dialect:'MssqlDialect',driver:'tedious+tarn',runtime:'edge',namespace:'schema',session:'external-acl',schema:'kysely'},
  {id:'sqlite',label:'SQLite',dialect:'SqliteDialect',driver:'sqlite',runtime:'persistent-gateway',namespace:'attached-database',session:'external-acl',schema:'kysely'}
];
export const SQL_ENGINE_PORTS=Object.freeze(ENGINE_DEFINITIONS.map(entry=>Object.freeze(entry)));
export const SQL_ENGINE_OPTIONS=Object.freeze(SQL_ENGINE_PORTS.map(({id,label})=>Object.freeze({value:id,label})));
const byId=new Map(SQL_ENGINE_PORTS.map(entry=>[entry.id,entry]));
export function getSqlEnginePort(engine){
  const result=byId.get(String(engine));
  if(!result)throw new Error('Unsupported SQL engine');
  return result;
}
export function getSqlRuntimeCapabilities(engine){
  const port=getSqlEnginePort(engine);
  return Object.freeze({
    dialect:port.dialect,
    driver:port.driver,
    runtime:port.runtime,
    namespace:port.namespace,
    session:port.session,
    schema:port.schema,
    operations:Object.freeze(['select','insert','update','delete','upsert'])
  });
}
// Runtime hook boundary: the core Kysely CRUD remains common to all SQL engines.
// PostgreSQL uses existing RLS; other engines require a trusted permission
// adapter before private reads or mutations can be enabled.
export function resolveSqlExecutionPort(target){
  const port=getSqlEnginePort(target.engine);
  return Object.freeze({engine:port.id,session:port.session,namespace:port.namespace,runtime:port.runtime});
}

// An external Kysely dialect does not inherit PostgreSQL RLS. Whitelisting
// table names is NOT sufficient for user content: Galaxy and Scope tables
// have per-row visibility policies. Until an equivalent engine-side
// authorization implementation exists, expose only fixed public reference tables.
export const CROSS_ENGINE_PUBLIC_READ_TABLES=Object.freeze([
  'runes','runes_etc','runes_group'
]);
const externalPublicReads=new Set(CROSS_ENGINE_PUBLIC_READ_TABLES);
export function assertCrossEnginePublicRead(request){
  if(request?.kind!=='query'||request.operation!=='select'||
      request.schema!=='silver'||typeof request.table!=='string'||
      !externalPublicReads.has(request.table)){
    const error=new Error('Cross-engine private data requires an authorization adapter');
    error.httpStatus=403;
    throw error;
  }
  return request;
}

const SCOPE_ID=/^[a-z][a-z0-9]{0,14}$/;
const PRIVATE_RELATION=/^([a-z][a-z0-9]{0,14})(?:_(galaxy|anchor|blocks|keywords|trace|time|galaxy_media))?$/;
const VERIFIED_EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/**
 * LOC ownership must be established independently of database login.
 * MySQL/MSSQL don't inherit PostgreSQL RLS, so never "reset role" and assume
 * writes became safe. Validate the verified Clerk identity against the
 * target database's own Scope Registry using only Kysely queries.
 *
 * This is the generic CRUD gate. Higher-level features must use Kysely and
 * the same ACL; PostgreSQL-specific actions are not dispatched here.
 */
export async function authorizeCrossEngineQuery(db,request,{role='anon',claims={}}={}){
  if(role!=='authenticated'){
    assertCrossEnginePublicRead(request);
    return;
  }
  if(request?.kind!=='query'||request.schema!=='silver'||
     typeof request.table!=='string'){
    const error=new Error('Unsupported cross-engine LOC request');
    error.httpStatus=403;throw error;
  }
  const email=String(claims.email||'').trim().toLowerCase();
  if(!VERIFIED_EMAIL.test(email)||claims.provider!=='clerk'||
     !/^user_[A-Za-z0-9]+$/.test(String(claims.sub||''))){
    const error=new Error('Verified Clerk identity required for cross-engine SQL');
    error.httpStatus=403;throw error;
  }
  const table=request.table;
  if(CROSS_ENGINE_PUBLIC_READ_TABLES.includes(table)&&request.operation==='select')
    return;
  const permissions=await db.selectFrom('silver.manage')
    .select(['id','email','manage_role','active'])
    .where('email','=',email).execute();
  const global=permissions.some(row=>row.id==='admin'&&row.manage_role==='admin');
  if(global)return;
  const match=table.match(PRIVATE_RELATION);
  const scope=match?.[1];
  const owner=scope&&SCOPE_ID.test(scope)&&permissions.some(row=>
    row.id===scope&&row.active===true&&
    (row.manage_role==='scope'||row.manage_role==='group'));
  if(!owner||table==='manage'||table==='loc'){
    const error=new Error('LOC Scope permission denied for selected SQL target');
    error.httpStatus=403;throw error;
  }
}
