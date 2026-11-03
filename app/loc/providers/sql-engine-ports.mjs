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

const SAFE_FIELD=/^[a-z][a-z0-9_]*$/i;
const ARTICLE_BATCH_FIELDS=new Set(['uid','title','content','place_id','url','media_link']);
function invalidWrite(message){
  const error=new Error(message);error.httpStatus=400;throw error;
}
function safeFilters(value){
  if(!Array.isArray(value)||value.length<1||value.length>20)
    invalidWrite('Managed write requires bounded filters');
  for(const item of value){
    if(!item||typeof item!=='object'||!SAFE_FIELD.test(item.column)||
       (item.operator||'eq')!=='eq')invalidWrite('Invalid managed write filter');
  }
  return value;
}
function applyKyselyFilters(query,filters){
  for(const f of filters)query=query.where(f.column,f.value===null?'is':'=',f.value);
  return query;
}
function managedAffected(result){
  return Number(result?.numInsertedOrUpdatedRows??result?.numUpdatedRows??
    result?.numDeletedRows??result?.numAffectedRows??0);
}
/**
 * Portable counterpart to the PostgreSQL management write procedure.
 * Reuses the verified cross-engine Registry gate and Kysely-native builders.
 * No PostgreSQL JSONB, regclass, stored procedure, RESET ROLE or DDL.
 */
export async function executeCrossEngineManagedWrite(db,body,context){
  const p=body?.payload;
  if(!p||typeof p!=='object'||Array.isArray(p))invalidWrite('Invalid managed payload');
  const matched=String(p.p_table||'').match(/^silver\.([a-z][a-z0-9_]*)$/);
  if(!matched)invalidWrite('Invalid managed relation');
  const table=matched[1],operation=String(p.p_operation||'');
  if(!['insert','update','delete','update_batch'].includes(operation))
    invalidWrite('Invalid managed operation');
  await authorizeCrossEngineQuery(db,{kind:'query',schema:'silver',table,
    operation:operation==='update_batch'?'update':operation},context);
  const name='silver.'+table;
  let count=0;
  if(operation==='insert'){
    const rows=p.p_rows;
    if(!Array.isArray(rows)||rows.length<1||rows.length>10000)
      invalidWrite('Invalid managed insert rows');
    for(const row of rows){
      if(!row||typeof row!=='object'||Array.isArray(row)||!Object.keys(row).length||
         Object.keys(row).some(key=>!SAFE_FIELD.test(key)||key==='able'))
        invalidWrite('Invalid managed insert columns');
    }
    // Batch by column shape to preserve omitted database defaults.
    // 50 rows bounds SQL Server's 2,100-parameter ceiling while avoiding
    // one round trip per imported article.
    const groups=new Map();
    for(const row of rows){
      const shape=Object.keys(row).sort().join('|');
      const group=groups.get(shape)||[];
      group.push(row);groups.set(shape,group);
    }
    for(const group of groups.values()){
      for(let i=0;i<group.length;i+=50){
        const batch=group.slice(i,i+50);
        const result=await db.insertInto(name).values(batch).executeTakeFirst();
        count+=managedAffected(result);
      }
    }
  }else if(operation==='update_batch'){
    if(!table.endsWith('_galaxy')||!Array.isArray(p.p_rows)||
       p.p_rows.length>10000)invalidWrite('Invalid Galaxy update batch');
    const seen=new Set();
    for(const row of p.p_rows){
      if(!row||typeof row!=='object'||Array.isArray(row)||
         !/^[A-Za-z0-9]{8}$/.test(String(row.uid||''))||
         seen.has(row.uid)||Object.keys(row).some(k=>!ARTICLE_BATCH_FIELDS.has(k)))
        invalidWrite('Invalid Galaxy batch row');
      seen.add(row.uid);
      const existing=await db.selectFrom(name)
        .select(['uid','title','content','place_id','url','media_link'])
        .where('uid','=',row.uid).executeTakeFirst();
      if(!existing)continue;
      const patch={};
      for(const key of ['title','content','url','media_link']){
        if(Object.hasOwn(row,key)&&JSON.stringify(row[key])!==JSON.stringify(existing[key]))
          patch[key]=row[key];
      }
      if(Object.hasOwn(row,'place_id')&&
         !String(existing.place_id||'').trim()&&String(row.place_id||'').trim())
        patch.place_id=String(row.place_id).trim();
      if(!Object.keys(patch).length)continue;
      patch.UpdateTime=new Date();
      const result=await db.updateTable(name).set(patch)
        .where('uid','=',row.uid).executeTakeFirst();
      count+=managedAffected(result);
    }
  }else{
    const filters=safeFilters(p.p_filters);
    if(operation==='update'){
      const values=p.p_values;
      if(!values||typeof values!=='object'||Array.isArray(values)||
         !Object.keys(values).length||
         Object.keys(values).some(key=>!SAFE_FIELD.test(key)||
           ['id','uid','able'].includes(key)))invalidWrite('Invalid update values');
      count=managedAffected(await applyKyselyFilters(db.updateTable(name).set(values),
        filters).executeTakeFirst());
    }else{
      count=managedAffected(await applyKyselyFilters(db.deleteFrom(name),
        filters).executeTakeFirst());
    }
  }
  return {data:{count},count:null};
}
