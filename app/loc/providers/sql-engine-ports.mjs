import {canManageLoc} from './loc-authorization.mjs';
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
// LOC-signed delegations authorize private operations regardless of database
// dialect; PostgreSQL's existing RLS is an independent database-side layer.
export function resolveSqlExecutionPort(target){
  const port=getSqlEnginePort(target.engine);
  // PostgreSQL is portable with or without provider-managed RLS roles.
  // Only the existing provider-specific gateways opt into session impersonation.
  const managedRls=port.id==='postgres'&&
    ['supabase','neon'].includes(String(target.provider||''))&&
    target.rls_enabled!==false;
  const session=port.id==='postgres'&&!managedRls?'external-acl':port.session;
  return Object.freeze({engine:port.id,session,namespace:port.namespace,runtime:port.runtime});
}

// An external Kysely dialect does not inherit PostgreSQL RLS. Whitelisting
// table names is NOT sufficient for user content: Galaxy and Scope tables
// have per-row visibility policies. Until an equivalent engine-side
// authorization implementation exists, expose only fixed public reference tables.
export const CROSS_ENGINE_PUBLIC_READ_TABLES=Object.freeze([
  'runes','runes_etc','runes_group'
]);
const externalPublicReads=new Set(CROSS_ENGINE_PUBLIC_READ_TABLES);
// LOC's routing, configuration and block presentation are public reference
// data regardless of SQL vendor. Keep private per-article filters separate.
const externalPublicApi=new Set(['manage','loc_user','user_settings']);
const externalPublicControl=new Set(['loc','lo3rwang','lrunes']);
const publicScopeBlocks=/^[a-z][a-z0-9]{0,14}_blocks$/;
const publicScopeData=/^[a-z][a-z0-9]{0,14}_(galaxy|anchor)$/;
function publicReference(request){
  const table=String(request?.table||'');
  return request?.schema==='api'&&externalPublicApi.has(table)||
    request?.schema==='silver'&&(
      externalPublicReads.has(table)||externalPublicControl.has(table)||
      publicScopeBlocks.test(table));
}
export function portableRelation(table,engine,namespace=''){
  if(!/^[a-z][a-z0-9_]*$/i.test(table))throw new Error('Invalid SQL relation');
  if(engine==='mysql')return table;
  const schema=String(namespace|| (engine==='mssql'?'dbo':'public'));
  if(!/^[a-z][a-z0-9_]*$/i.test(schema))throw new Error('Invalid SQL namespace');
  return schema+'.'+table;
}
export function assertCrossEnginePublicRead(request){
  if(request?.kind!=='query'||request.operation!=='select'||
      typeof request.table!=='string'||!(
        publicReference(request)||
        request.schema==='silver'&&publicScopeData.test(request.table))){
    const error=new Error('External SQL public read requires a published LOC relation');
    error.httpStatus=403;
    throw error;
  }
  return {publicOnly:publicScopeData.test(request.table)};
}

const SCOPE_ID=/^[a-z][a-z0-9]{0,14}$/;
const PRIVATE_RELATION=/^([a-z][a-z0-9]{0,14})(?:_(galaxy|anchor|blocks|keywords|trace|time|galaxy_media))?$/;
const VERIFIED_EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/**
 * LOC delegation is verified by the trusted Edge before any database call.
 * The local signed Scope grant, not the database's identity provider or
 * a second Scope Registry query, controls portable private operations.
 *
 * This is the generic CRUD gate. Higher-level features reuse the same
 * LOC-managed authority. PostgreSQL-specific actions are not dispatched here.
 */
export async function authorizeCrossEngineQuery(db,request,{role='anon',claims={}}={}){
  if(role!=='authenticated')
    return assertCrossEnginePublicRead(request);
  // Public reference relations stay readable under an authenticated session.
  if(request?.kind==='query'&&request.operation==='select'&&
     publicReference(request))return {publicOnly:false};
  if(request?.kind!=='query'||request.schema!=='silver'||
     typeof request.table!=='string'){
    const error=new Error('Unsupported cross-engine LOC request');
    error.httpStatus=403;throw error;
  }
  const table=request.table;
  if(CROSS_ENGINE_PUBLIC_READ_TABLES.includes(table)&&request.operation==='select')
    return {publicOnly:false};
  if(table==='loc'||table==='manage'){
    if(!await canManageLoc(db,'global'))throw Object.assign(
      new Error('Global LOC permission denied'),{httpStatus:403});
    return {publicOnly:false};
  }
  const scope=table.match(PRIVATE_RELATION)?.[1];
  const permitted=await canManageLoc(db,'global')||
    scope&&SCOPE_ID.test(scope)&&await canManageLoc(db,'scope',scope);
  if(permitted)return {publicOnly:false};
  if(request.operation==='select'&&publicScopeData.test(table))
    return {publicOnly:true};
  throw Object.assign(
    new Error('LOC Scope permission denied for selected SQL target'),{httpStatus:403});
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
function matchingPortableField(key,incoming,stored,engine){
  // SQL Server returns JSON stored in nvarchar as text; MySQL drivers may
  // return native JSON or text. Compare media_link by its array value so a
  // repeat import does not issue an UPDATE only because the read type differs.
  if(key==='media_link'&&engine!=='postgres'){
    const decode=value=>{
      if(typeof value!=='string')return value;
      try{
        const parsed=JSON.parse(value);
        return Array.isArray(parsed)?parsed:value;
      }catch{return value;}
    };
    return JSON.stringify(decode(incoming))===JSON.stringify(decode(stored));
  }
  return JSON.stringify(incoming)===JSON.stringify(stored);
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
  const name=portableRelation(table,context.engine,context.namespace);
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
    // SQL Server limits one statement to 2,100 bound parameters. Derive
    // batch size from its row width rather than assuming 50 rows always fit.
    const groups=new Map();
    for(const row of rows){
      const shape=Object.keys(row).sort().join('|');
      const group=groups.get(shape)||[];
      group.push(row);groups.set(shape,group);
    }
    const batches=[...groups.values()].map(group=>{
      const columns=Object.keys(group[0]).length;
      // Reserve capacity below SQL Server's 2,100 parameter maximum.
      const size=context.engine==='mssql'?Math.min(50,Math.floor(2000/columns)):50;
      if(size<1)invalidWrite('Managed insert row exceeds SQL Server parameter limit');
      return {group,size};
    });
    for(const {group,size} of batches){
      for(let i=0;i<group.length;i+=size){
        const batch=group.slice(i,i+size);
        const result=await db.insertInto(name).values(serializePortableJsonFields(batch,context.engine)).executeTakeFirst();
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
         seen.has(row.uid)||!Object.keys(row).some(k=>k!=='uid')||
         Object.keys(row).some(k=>!ARTICLE_BATCH_FIELDS.has(k)))
        invalidWrite('Invalid Galaxy batch row');
      seen.add(row.uid);
    }
    // Read only fields supplied by the import. Full Galaxy content can be
    // large and is not needed when updating media links or locations.
    const fields=['title','content','place_id','url','media_link']
      .filter(field=>p.p_rows.some(row=>Object.hasOwn(row,field)));
    const existingRows=new Map();
    for(let i=0;i<p.p_rows.length;i+=1000){
      const uids=p.p_rows.slice(i,i+1000).map(row=>row.uid);
      const found=await db.selectFrom(name)
        .select(['uid',...fields]).where('uid','in',uids).execute();
      for(const row of found)existingRows.set(String(row.uid),row);
    }
    const groups=new Map();
    for(const row of p.p_rows){
      const existing=existingRows.get(row.uid);
      if(!existing)continue;
      const patch={};
      for(const key of ['title','content','url','media_link']){
        if(Object.hasOwn(row,key)&&!matchingPortableField(key,row[key],existing[key],context.engine))
          patch[key]=row[key];
      }
      if(Object.hasOwn(row,'place_id')&&
         !String(existing.place_id||'').trim()&&String(row.place_id||'').trim())
        patch.place_id=String(row.place_id).trim();
      if(!Object.keys(patch).length)continue;
      // Identical patches share a native Kysely UPDATE ... WHERE uid IN (...).
      // Independent article values remain separate and preserve their semantics.
      const key=JSON.stringify(patch);
      if(!groups.has(key))groups.set(key,{patch,uids:[]});
      groups.get(key).uids.push(row.uid);
    }
    for(const {patch,uids} of groups.values()){
      for(let i=0;i<uids.length;i+=50){
        const batch=uids.slice(i,i+50);
        const values=serializePortableJsonFields(
          {...patch,UpdateTime:new Date()},context.engine);
        // A parallel import cannot overwrite an already-filled place_id.
        // Use Kysely's native CASE expression instead of relying on an
        // earlier SELECT snapshot for this fill-only field.
        const update=db.updateTable(name);
        const query=Object.hasOwn(patch,'place_id')
          ?update.set(eb=>({
            ...values,
            place_id:eb.case().when(
              eb.fn('trim',[eb.fn.coalesce('place_id',eb.val(''))]),'=', ''
            ).then(patch.place_id).elseRef('place_id').end()
          }))
          :update.set(values);
        const result=await query.where('uid','in',batch).executeTakeFirst();
        count+=managedAffected(result);
      }
    }
  }else{
    const filters=safeFilters(p.p_filters);
    if(operation==='update'){
      const values=p.p_values;
      if(!values||typeof values!=='object'||Array.isArray(values)||
         !Object.keys(values).length||
         Object.keys(values).some(key=>!SAFE_FIELD.test(key)||
           ['id','uid','able'].includes(key)))invalidWrite('Invalid update values');
      count=managedAffected(await applyKyselyFilters(db.updateTable(name).set(serializePortableJsonFields(values,context.engine)),
        filters).executeTakeFirst());
    }else{
      count=managedAffected(await applyKyselyFilters(db.deleteFrom(name),
        filters).executeTakeFirst());
    }
  }
  return {data:{count},count:null};
}

export const PORTABLE_JSON_COLUMNS=Object.freeze([
  'attr','block_entity','status','media_link','blacklist','theme','keywords','database',
  'keyword_meta','DefaultArticleClass','search_aliases','target_id'
]);
const portableJsonFields=new Set(PORTABLE_JSON_COLUMNS);
export function serializePortableJsonFields(values,engine){
  if(engine==='postgres'||!values||typeof values!=='object')return values;
  if(Array.isArray(values))return values.map(row=>serializePortableJsonFields(row,engine));
  return Object.fromEntries(Object.entries(values).map(([key,value])=>
    [key,portableJsonFields.has(key)&&value!==null&&typeof value==='object'
      ?JSON.stringify(value):value]));
}
