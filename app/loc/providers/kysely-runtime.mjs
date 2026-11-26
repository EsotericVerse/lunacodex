import {sql} from 'kysely';
import {postgresNativeUpsert,postgresMutationReturning,postgresContainsPredicate} from '../../../modules/loc/dialect/postgres.mjs';
import {mysqlMutationReturning,mysqlLockPrimaryKeys} from '../../../modules/loc/dialect/mysql.mjs';
import {mssqlMutationReturning,mssqlCheckPagination,mssqlLockPrimaryKeys} from '../../../modules/loc/dialect/mssql.mjs';
import {serializePortableJsonFields,portableRelation,getSqlEnginePort} from './sql-engine-ports.mjs';
import {validateLocRegistryDomain} from './loc-domain.mjs';
import {portableContainsSpec,parsePortableOrExpression} from './portable-search.mjs';
import {verifyModeledSqlFields,normalizeModeledTypeDifferences,
  normalizeModeledSelectRows,modeledPrimaryKeyColumns} from '../../../packages/zenstack/model-column-guard.mjs';
import {assertZModelSelectRows} from '../../../packages/zenstack/import-validation.mjs';
import {assertKyselyQueryShape,QUERY_FILTER_SQL}
  from '../../../packages/zenstack/sql-input-shape.mjs';
import {ANCHOR_TYPE_GROUPS} from '../../../packages/zenstack/anchor-hierarchy.mjs';

const identifier=/^[a-z][a-z0-9_]*$/i;
const schemas=new Set(['silver','api']);
const operators=QUERY_FILTER_SQL;
function checkedFilterColumn(value){
  return checkedIdentifier(value,'filter column');
}

function checkedIdentifier(value,label){
  if(typeof value!=='string'||!identifier.test(value))throw new Error('Invalid '+label);
  return value;
}

function validateQuery(input){
  // One Zod syntax contract is shared with the managed-write boundary.
  // ZModel then validates actual physical columns; neither grants access.
  assertKyselyQueryShape(input);
  const {schema,table}=input;
  if(!schemas.has(schema))throw new Error('Schema is not enabled');
  const filters=input.filters||[];
  if(filters.some(filter=>filter.operator==='in'&&!Array.isArray(filter.value)))
    throw new Error('Invalid filter');
  if(['update','delete'].includes(input.operation)&&!filters.length)
    throw new Error('Unfiltered writes are forbidden');
  if(['insert','upsert'].includes(input.operation)&&filters.length)
    throw new Error('Filters are not supported for insert or upsert');
  const columns=input.columns?.length?input.columns:['*'];
  const orders=input.orders||[];
  if(['insert','update','upsert'].includes(input.operation)){
    const rows=Array.isArray(input.values)?input.values:[input.values];
    if(!input.values||typeof input.values!=='object'||!rows.length||
       rows.some(row=>!row||typeof row!=='object'||Array.isArray(row)))
      throw new Error('Write values are required');
    if(input.operation==='update'&&Array.isArray(input.values))
      throw new Error('Update values must be an object');
  }
  if(input.operation==='upsert'&&(!Array.isArray(input.onConflict)||!input.onConflict.length||
    input.onConflict.some(col=>typeof col!=='string'||!identifier.test(col))))
    throw new Error('Upsert conflict columns are required');
  const limit=input.limit==null?null:Number(input.limit);
  const offset=input.offset==null?0:Number(input.offset);
  if(limit!==null&&(!Number.isSafeInteger(limit)||limit<0)||
    !Number.isSafeInteger(offset)||offset<0)
    throw new Error('Invalid SQL page bounds');
  const orFilters=(input.or||[]).map(parsePortableOrExpression);
  verifyModeledSqlFields({schema,table,columns,filters,orFilters,orders,
    values:input.values,onConflict:input.onConflict||[]});
  const typed=normalizeModeledTypeDifferences({schema,table,filters,orFilters});
  return {...input,schema,table,filters:typed.filters,columns,orders,limit,offset,
    orFilters:typed.orFilters};
}

function containsPredicate(column,term,dialect='postgres'){
  const {fold,pattern}=portableContainsSpec(term);
  if(dialect==='postgres')return postgresContainsPredicate(column,pattern,fold);
  return fold
    ?sql`lower(${sql.ref(column)}) like ${pattern} escape '!'`
    :sql`${sql.ref(column)} like ${pattern} escape '!'`;
}
function applyFilters(query,filters,dialect='postgres'){
  for(const filter of filters){
    const op=operators[filter.operator],column=checkedFilterColumn(filter.column);
    const value=filter.value;
    if(filter.operator==='in')query=filter.negate?query.where(eb=>eb.not(eb(column,'in',value))):query.where(column,'in',value);
    else if(filter.operator==='ilike'){
      const comparison=dialect==='postgres'
        ?sql`${sql.ref(column)} ${sql.raw(filter.negate?'not ilike':'ilike')} ${String(value)}`
        :sql`lower(${sql.ref(column)}) ${sql.raw(filter.negate?'not like':'like')} ${String(value).toLowerCase()}`;
      query=query.where(comparison);
    }
    else if(filter.operator==='ieq')query=query.where(sql`lower(${sql.ref(column)})`,filter.negate?'!=':'=',String(value).toLowerCase());
    else if(filter.operator==='contains')query=query.where(filter.negate
      ?sql`not (${containsPredicate(column,value,dialect)})`:containsPredicate(column,value,dialect));
    else if(filter.operator==='is')query=query.where(column,value===null?(filter.negate?'is not':'is'):(filter.negate?'!=':'='),value);
    else query=filter.negate?query.where(eb=>eb.not(eb(column,op,value))):query.where(column,op,value);
  }
  return query;
}

function applyOrFilters(query,groups,dialect='postgres'){
  const predicate=(eb,node)=>{
    if(node.type==='and')return eb.and(node.items.map(item=>predicate(eb,item)));
    if(node.type==='or')return eb.or(node.items.map(item=>predicate(eb,item)));
    if(node.operator==='ilike')return dialect==='postgres'
      ?sql`${sql.ref(node.column)} ilike ${String(node.value)}`
      :eb(sql`lower(${sql.ref(node.column)})`,'like',String(node.value).toLowerCase());
    if(node.operator==='ieq')return eb(sql`lower(${sql.ref(node.column)})`,'=',String(node.value).toLowerCase());
    if(node.operator==='contains')return containsPredicate(node.column,node.value,dialect);
    if(node.operator==='is'&&node.value!==null)return eb(node.column,'=',node.value);
    return eb(node.column,operators[node.operator],node.value);
  };
  for(const group of groups)query=query.where(eb=>predicate(eb,group));
  return query;
}

const PRIVATE_SITES=['messenger','chatgpt','claude','gemini','msn','whatsapp',
  'telegram','discord','line','wechat','teams','copilot','grok','perplexity','meta ai','meta-ai',
  'mcp','github'];
const PUBLIC_ANCHOR_TYPES=[...ANCHOR_TYPE_GROUPS.time,...ANCHOR_TYPE_GROUPS.space,
  ...ANCHOR_TYPE_GROUPS.media];
function databaseTable(req,dialect,namespace,modelName=''){
  // ZenStack PolicyPlugin maps a fixed logical model to the physical table.
  if(modelName)return modelName;
  // MySQL selects its database at connection time; "silver" is a logical
  // LOC schema, never a physical database qualifier in generated SQL.
  return portableRelation(req.table,dialect,namespace===undefined?req.schema:namespace);
}
function publishedOnly(query,table,enabled,columns=['*']){
  if(!enabled)return query;
  if(table.endsWith('_galaxy')){
    let published=query.where(enabled==='list'?'list':'search','=',true)
      .where(eb=>eb.or([eb('site','is',null),
        eb(eb.fn('lower',['site']),'not in',PRIVATE_SITES)]));
    // A non-clickable search result may expose its title/metadata, but not
    // its full article. A wildcard projection also contains article content.
    if(columns.includes('*')||columns.includes('content'))
      published=published.where('list','=',true);
    return published;
  }
  if(table.endsWith('_anchor'))
    return query.where('invisible','=',false)
      .where('type','in',PUBLIC_ANCHOR_TYPES);
  throw new Error('Unpublished external relation');
}
export function buildKyselySelectQuery(trx,input,{dialect='postgres',namespace,publicOnly=false,modelName=''}={}){
  const req=validateQuery(input);
  if(req.operation!=='select')throw new Error('Unsupported operation for SELECT builder');
  const table=databaseTable(req,dialect,namespace,modelName);
  let query=publishedOnly(applyOrFilters(applyFilters(
    trx.selectFrom(table).select(req.columns),req.filters,dialect),req.orFilters,dialect),req.table,publicOnly,req.columns);
  let nativeNullsLast=false;
  if(req.federatedNullsLast===true&&req.orders.length===1&&
     ['date','createtime'].includes(req.orders[0].column)){
    const order=req.orders[0],sortColumn=order.column;
    if(dialect==='postgres'){
      query=query.orderBy(sql`${sql.ref(sortColumn)} ${sql.raw(order.ascending===false?'desc':'asc')} nulls last`);
      nativeNullsLast=true;
    }else{
      query=query.orderBy(sql`case when ${sql.ref(sortColumn)} is null then 1 else 0 end`,'asc');
    }
  }
  for(const [index,order] of req.orders.entries()){
    if(nativeNullsLast&&index===0)continue;
    query=query.orderBy(order.column,order.ascending===false?'desc':'asc');
  }
  if(dialect==='mssql')mssqlCheckPagination(req);
  if(req.limit!==null)query=query.limit(req.limit);
  // SQL Server requires ORDER BY for OFFSET; OFFSET 0 is not a harmless
  // default there. Avoid emitting it unless the caller actually paginates.
  if(req.offset>0)query=query.offset(req.offset);
  // COUNT(*) is intentionally unpaged on every SQL Type.
  const countQuery=req.count?publishedOnly(applyOrFilters(applyFilters(
    trx.selectFrom(table).select(trx.fn.countAll().as('count')),req.filters,dialect),req.orFilters,dialect),
      req.table,publicOnly,req.columns):null;
  return {request:req,query:req.head?null:query,countQuery};
}

// Native Kysely row streaming. PostgreSQL uses pg-cursor, MySQL uses mysql2's
// readable query stream, and SQL Server uses Tedious request chunks. The
// iterator validates each row without materializing the full result set.
export async function executeKyselySelectStream(trx,input,{
  dialect='postgres',namespace,publicOnly=false,modelName='',chunkSize,signal
}={}){
  const req=validateQuery(input);
  if(req.operation!=='select')throw new Error('Streaming supports SELECT only');
  if(req.single)throw new Error('Single-row assertions are not supported by streaming SELECT');
  const built=buildKyselySelectQuery(trx,input,{dialect,namespace,publicOnly,modelName});
  const type=getSqlEnginePort(dialect);
  const size=chunkSize===undefined?type.streamChunkRows:Number(chunkSize);
  if(!Number.isSafeInteger(size)||size<1||size>4096)
    throw new Error('Invalid SQL stream chunk size');
  // Preserve COUNT(*) semantics: count is a separate unbounded aggregate and
  // is completed before the row iterator is handed to its consumer.
  const count=built.countQuery
    ?Number((await built.countQuery.executeTakeFirstOrThrow()).count):null;
  const data=(async function*(){
    if(!built.query)return;
    const options=signal?{chunkSize:size,signal}:{chunkSize:size};
    for await(const row of built.query.stream(options)){
      const normalized=normalizeModeledSelectRows({
        schema:req.schema,table:req.table,rows:[row]
      });
      const checked=assertZModelSelectRows(req.schema+'.'+req.table,req.columns,normalized);
      yield checked[0];
    }
  })();
  return {data,count};
}

// Kysely-native UPSERT batches: adjacent equal-shape rows only.
// A duplicate primary key starts a new statement to preserve input order.
export function planKyselyUpsertBatches(rows,primary,{
  dialect='postgres',maxParameters,maxRows,maxBytes
}={}){
  const type=getSqlEnginePort(dialect);
  const parameterLimit=maxParameters??type.upsertParameterLimit;
  const rowLimit=maxRows??type.upsertMaxRows;
  const byteLimit=maxBytes??type.maxBatchBytes;
  const keys=Array.isArray(primary)?primary:[primary];
  if(!Array.isArray(rows)||!rows.length||!keys.length||
    keys.some(key=>typeof key!=='string'||!key)||
    !Number.isSafeInteger(parameterLimit)||parameterLimit<1||
    !Number.isSafeInteger(rowLimit)||rowLimit<1||
    !Number.isSafeInteger(byteLimit)||byteLimit<1)
    throw new TypeError('UPSERT rows and SQL Type batch budgets are required');
  const encoder=new TextEncoder(),batches=[];
  let group=[],shape='',bytes=0,seen=new Set();
  const flush=()=>{if(group.length)batches.push(group);group=[];shape='';bytes=0;seen=new Set();};
  for(const row of rows){
    if(!row||typeof row!=='object'||Array.isArray(row)||
      keys.some(key=>row[key]===null||row[key]===undefined))
      throw new TypeError('UPSERT primary key is required');
    const columns=Object.keys(row).sort(),nextShape=columns.join('\0');
    // Non-PostgreSQL CASE updates bind each primary key in both its CASE
    // predicate and WHERE predicate. Budget that extra dialect-specific width.
    const parameterWidth=columns.length+(dialect==='postgres'?0:keys.length);
    if(parameterWidth>parameterLimit)
      throw new RangeError('UPSERT row exceeds the selected SQL Type parameter budget');
    const limit=Math.min(rowLimit,Math.floor(parameterLimit/parameterWidth));
    const identity=JSON.stringify(keys.map(key=>String(row[key])));
    const serialized=JSON.stringify(row,(_key,value)=>
      typeof value==='bigint'?value.toString():value);
    const size=encoder.encode(serialized).byteLength;
    if(group.length&&(shape!==nextShape||group.length>=limit||
      bytes+size>byteLimit||seen.has(identity)))flush();
    if(!group.length)shape=nextShape;
    group.push(row);seen.add(identity);bytes+=size;
  }
  flush();
  return batches;
}

function sameKeys(rows){
  const keys=Object.keys(rows[0]||{}).sort().join('\0');
  return rows.every(row=>Object.keys(row).sort().join('\0')===keys);
}

export function buildKyselyUpsertQuery(trx,req,dialect='postgres',namespace){
  const rows=Array.isArray(req.values)?req.values:[req.values];
  if(!sameKeys(rows))throw new Error('Upsert rows must have the same columns');
  const table=databaseTable(req,dialect,namespace);
  const updateColumns=Object.keys(rows[0]||{}).filter(col=>!req.onConflict.includes(col));
  const insert=trx.insertInto(table).values(req.values);
  if(dialect==='mysql')
    throw new Error('MySQL UPSERT requires executeMysqlUpsert inside an active transaction');
  if(dialect==='postgres')return postgresNativeUpsert(insert,req,updateColumns);
  throw new Error('UPSERT is not implemented for this LOC SQL dialect');
}

// SQL Server has no targeted ON CONFLICT. MySQL's ON DUPLICATE KEY UPDATE
// also matches every unique index, not only the modeled PK. Both engines use
// one ordered primary-key lock read, a CASE-based set update and one multi-row
// insert inside the caller's existing transaction. No MERGE or extra pool.
export async function executeMssqlUpsert(trx,req,options={}){
  return executePortableKeyedUpsert(trx,req,{...options,dialect:'mssql'});
}
export async function executeMysqlUpsert(trx,req,options={}){
  return executePortableKeyedUpsert(trx,req,{...options,dialect:'mysql'});
}
function portableKeyIdentity(row,primary){
  return JSON.stringify(primary.map(column=>String(row[column])));
}
function portableKeyPredicate(row,primary){
  return sql`(${sql.join(primary.map(column=>
    sql`${sql.ref(column)} = ${row[column]}`),sql` and `)})`;
}
async function executePortableKeyedUpsert(trx,req,{dialect,namespace,modelName='',guardFilter=null}={}){
  if(trx?.isTransaction!==true)
    throw new Error('Portable UPSERT requires an active Kysely transaction');
  if(!['mssql','mysql'].includes(dialect))
    throw new Error('Unsupported keyed UPSERT SQL dialect');
  if(req?.operation!=='upsert')
    throw new Error('Portable UPSERT requires an upsert request');
  const rows=Array.isArray(req.values)?req.values:[req.values];
  if(!rows.length||!sameKeys(rows))
    throw new Error('Invalid portable UPSERT rows');
  if(dialect==='mysql'&&req.returning)
    throw new Error('MySQL has no native UPSERT RETURNING');
  const primary=modeledPrimaryKeyColumns(req.schema,req.table);
  if(!primary?.length||primary.length!==req.onConflict?.length||
    primary.some((column,index)=>column!==req.onConflict[index]))
    throw new Error('Portable UPSERT requires the exact modeled primary key');
  if(guardFilter&&(!guardFilter||typeof guardFilter!=='object'||
    typeof guardFilter.column!=='string'||!identifier.test(guardFilter.column)||
    guardFilter.value===undefined||guardFilter.value===null))
    throw new Error('Invalid portable UPSERT guard filter');
  if(guardFilter&&rows.some(row=>row[guardFilter.column]!==guardFilter.value))
    throw new Error('Portable UPSERT rows do not match their page or Scope guard');
  const type=getSqlEnginePort(dialect);
  const guardColumns=guardFilter?[guardFilter.column]:[];
  const batches=planKyselyUpsertBatches(rows,primary,{
    dialect,maxParameters:type.upsertParameterLimit,
    maxRows:type.upsertMaxRows,maxBytes:type.maxBatchBytes
  });
  const data=[];
  let count=0;
  for(const batch of batches){
    const table=databaseTable(req,dialect,namespace,modelName);
    const requested=new Set(batch.map(row=>portableKeyIdentity(row,primary)));
    const found=dialect==='mssql'
      ?await mssqlLockPrimaryKeys(trx,table,primary,batch,guardColumns)
      :await mysqlLockPrimaryKeys(trx,table,primary,batch,guardColumns);
    const foundByKey=new Map();
    for(const row of found){
      const identity=portableKeyIdentity(row,primary);
      if(!requested.has(identity))
        throw new Error('Portable UID collation does not preserve exact identity');
      if(foundByKey.has(identity))
        throw new Error('Non-unique portable UPSERT primary key');
      foundByKey.set(identity,row);
    }
    const existing=[],missing=[];
    for(const row of batch){
      const identity=portableKeyIdentity(row,primary);
      const match=foundByKey.get(identity);
      if(match){
        if(primary.some(column=>match[column]!==row[column]))
          throw new Error('Portable UID collation does not preserve exact identity');
        if(guardFilter&&match[guardFilter.column]!==guardFilter.value)
          throw Object.assign(new Error('Portable UPSERT row changed its page or Scope identity'),
            {httpStatus:409});
        existing.push(row);
      }else missing.push(row);
    }
    const updates=Object.keys(batch[0]).filter(column=>!primary.includes(column));
    const returnedByKey=new Map();
    const outputColumns=req.returning&&dialect==='mssql'
      ?req.columns.includes('*')?['*']:[...new Set([...primary,...req.columns])]
      :req.columns;
    if(existing.length&&!req.ignoreDuplicates&&updates.length){
      const assignments=Object.fromEntries(updates.map(column=>[
        column,sql`case ${sql.join(existing.map(row=>
          sql`when ${portableKeyPredicate(row,primary)} then ${row[column]}`),sql` `)}
          else ${sql.ref(column)} end`
      ]));
      let query=trx.updateTable(table).set(assignments)
        .where(eb=>eb.or(existing.map(row=>eb.and(
          primary.map(column=>eb(column,'=',row[column]))
        ))));
      if(guardFilter)query=query.where(guardFilter.column,'=',guardFilter.value);
      if(dialect==='mssql'&&req.returning)
        query=mssqlMutationReturning(query,{...req,columns:outputColumns,operation:'update'});
      const outcome=await query.execute();
      if(req.returning){
        for(const row of outcome)returnedByKey.set(portableKeyIdentity(row,primary),row);
      }else count+=existing.length;
    }
    if(missing.length){
      let query=trx.insertInto(table).values(missing);
      if(dialect==='mssql'&&req.returning)
        query=mssqlMutationReturning(query,{...req,columns:outputColumns,operation:'insert'});
      const outcome=await query.execute();
      if(req.returning){
        for(const row of outcome)returnedByKey.set(portableKeyIdentity(row,primary),row);
      }else{
        const affected=Number(outcome[0]?.numAffectedRows??
          outcome[0]?.numInsertedOrUpdatedRows??outcome[0]?.numUpdatedRows??0);
        if(affected!==missing.length)
          throw new Error('Portable UPSERT insert count mismatch');
        count+=missing.length;
      }
    }
    if(req.returning){
      for(const row of batch){
        const returned=returnedByKey.get(portableKeyIdentity(row,primary));
        if(returned){
          data.push(req.columns.includes('*')?returned:Object.fromEntries(
            req.columns.map(column=>[column,returned[column]])
          ));
        }
      }
    }
  }
  return req.returning?{data,count:null}:{data:null,count};
}

function applyMutationReturning(query,req,dialect){
  if(dialect==='postgres')return postgresMutationReturning(query,req);
  if(dialect==='mysql')return mysqlMutationReturning(query,req);
  if(dialect==='mssql')return mssqlMutationReturning(query,req);
  throw new Error('Unsupported LOC mutation RETURNING dialect');
}

export function buildKyselyMutationQuery(trx,input,{dialect='postgres',namespace,modelName=''}={}){
  const validated=validateQuery(input);
  const registryValues=validated.schema==='api'&&validated.table==='manage'
    ?Array.isArray(validated.values)
      ?validated.values.map(validateLocRegistryDomain)
      :validateLocRegistryDomain(validated.values)
    :validated.values;
  const stamped=validated.schema==='silver'&&validated.table==='VisualNovel'&&
    ['update','upsert'].includes(validated.operation)
    ?Array.isArray(registryValues)
      ?registryValues.map(row=>({...row,updated_at:new Date()}))
      :{...registryValues,updated_at:new Date()}
    :registryValues;
  const req={...validated,values:serializePortableJsonFields(stamped,dialect)};
  const fullTable=databaseTable(req,dialect,namespace,modelName);
  if(!['insert','update','delete','upsert'].includes(req.operation))throw new Error('Unsupported mutation');
  let query;
  if(req.operation==='insert')query=trx.insertInto(fullTable).values(req.values);
  if(req.operation==='upsert')query=buildKyselyUpsertQuery(trx,req,dialect,namespace);
  if(req.operation==='update')query=trx.updateTable(fullTable).set(req.values);
  if(req.operation==='delete')query=trx.deleteFrom(fullTable);
  query=applyOrFilters(applyFilters(query,req.filters,dialect),req.orFilters,dialect);
  return {request:req,query:applyMutationReturning(query,req,dialect)};
}

/**
 * @param {any} trx
 * @param {any} input
 * @param {{dialect?:string, namespace?:string, publicOnly?:boolean, modelName?:string}} [options]
 */
export async function executeKyselyQuery(trx,input,{
  dialect='postgres',namespace,publicOnly=false,modelName='',
  stream=false,chunkSize,signal
}={}){
  const req=validateQuery(input);
  if(stream)return executeKyselySelectStream(trx,input,{
    dialect,namespace,publicOnly,modelName,chunkSize,signal
  });
  let data=null,count=null;
  if(req.operation==='select'){
    const built=buildKyselySelectQuery(trx,input,{dialect,namespace,publicOnly,modelName});
    if(built.countQuery){const row=await built.countQuery.executeTakeFirstOrThrow();count=Number(row.count)}
    if(built.query){
      data=normalizeModeledSelectRows({
        schema:req.schema,table:req.table,rows:await built.query.execute()
      });
      data=assertZModelSelectRows(req.schema+'.'+req.table,req.columns,data);
    }
  }else if(req.operation==='upsert'&&dialect==='postgres'){
    const rows=Array.isArray(req.values)?req.values:[req.values];
    const batches=planKyselyUpsertBatches(rows,req.onConflict,{dialect});
    if(req.returning)data=[];
    else count=0;
    for(const batch of batches){
      const built=buildKyselyMutationQuery(trx,{...input,values:batch},
        {dialect,namespace,modelName});
      const result=await built.query.execute();
      if(req.returning)data.push(...result);
      else count+=Number(result[0]?.numAffectedRows??
        result[0]?.numInsertedOrUpdatedRows??result[0]?.numUpdatedRows??0n);
    }
  }else if(['mssql','mysql'].includes(dialect)&&req.operation==='upsert'){
    const prepared={...req,values:serializePortableJsonFields(req.values,dialect)};
    const executor=dialect==='mssql'?executeMssqlUpsert:executeMysqlUpsert;
    ({data,count}=await executor(trx,prepared,{namespace,modelName}));
  }else{
    const built=buildKyselyMutationQuery(trx,input,{dialect,namespace,modelName});
    const result=await built.query.execute();
    if(req.returning)data=result;
    else {const affected=result[0]?.numAffectedRows??result[0]?.numInsertedOrUpdatedRows??result[0]?.numUpdatedRows??result[0]?.numDeletedRows??0n;count=Number(affected)}
  }
  // A Scope config display name and silver.loc directory label are one
  // logical write. Replace the PostgreSQL trigger with the same Kysely
  // transaction; do not issue a second network request or stored procedure.
  if((Number(count||0)>0||Array.isArray(data)&&data.length>0)&&
     dialect==='postgres'&&namespace===undefined&&req.schema==='silver'&&
     /^[a-z][a-z0-9]{0,14}$/.test(req.table)&&req.table!=='loc'&&
     ['insert','update','upsert'].includes(req.operation)){
    const rows=Array.isArray(req.values)?req.values:[req.values];
    for(const row of rows){
      if(!row||!Object.hasOwn(row,'display_name')||
        ['insert','upsert'].includes(req.operation)&&row.id!==req.table)continue;
      const title=String(row.display_name??'').trim();
      if(!title)throw new Error('Scope display name cannot be empty');
      await trx.updateTable('silver.loc').set({display_name:title})
        .where('id','=',req.table).execute();
    }
  }
  if(req.single){const rows=Array.isArray(data)?data:[];if(rows.length>1||(req.single==='single'&&rows.length!==1))throw Object.assign(new Error('Row count mismatch'),{code:'PGRST116'});data=rows[0]||null}
  return {data,count};
}

// SQL operations have no stored-procedure dispatch. All calls now use
// Kysely query, Anchor, Analytics or vetted management action executors.
export function isKyselyClientError(error){return error instanceof Error&&['Invalid','Unsupported','Unfiltered','Write','Update','Unexpected','RPC','Schema','Too many','Malformed','Filters','OR filters','SQL theme','Missing'].some(prefix=>error.message.startsWith(prefix))}
