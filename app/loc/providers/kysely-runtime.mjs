import {sql} from 'npm:kysely@0.29.8';
import {DB_QUERY_BATCH_SIZE} from '../query-batch-size.mjs';
import {serializePortableJsonFields,portableRelation} from './sql-engine-ports.mjs';
import {validateLocRegistryDomain} from './loc-domain.mjs';
import {portableContainsSpec,parsePortableOrExpression} from './portable-search.mjs';

const identifier=/^[a-z][a-z0-9_]*$/i;
const schemas=new Set(['silver','api']);
const operators={eq:'=',neq:'!=',gt:'>',gte:'>=',lt:'<',lte:'<=',like:'like',ilike:'ilike',contains:'contains',is:'is',in:'in'};
function checkedFilterColumn(value){
  return checkedIdentifier(value,'filter column');
}

function checkedIdentifier(value,label){
  if(typeof value!=='string'||!identifier.test(value))throw new Error('Invalid '+label);
  return value;
}

function validateQuery(input){
  if(!input||input.kind!=='query')throw new Error('Invalid request kind');
  const schema=checkedIdentifier(input.schema,'schema');
  const table=checkedIdentifier(input.table,'table');
  if(!schemas.has(schema))throw new Error('Schema is not enabled');
  if(!['select','insert','update','delete','upsert'].includes(input.operation))throw new Error('Unsupported operation');
  if(input.filters!==undefined&&!Array.isArray(input.filters))throw new Error('Invalid filters');
  const filters=input.filters||[];
  for(const filter of filters){
    if(!filter||typeof filter!=='object'||Array.isArray(filter))throw new Error('Invalid filter');
    checkedFilterColumn(filter.column);
    if(!operators[filter.operator]||(filter.operator==='in'&&!Array.isArray(filter.value)))throw new Error('Invalid filter');
  }
  if(['update','delete'].includes(input.operation)&&!filters.length)throw new Error('Unfiltered writes are forbidden');
  if(['insert','upsert'].includes(input.operation)&&filters.length)throw new Error('Filters are not supported for insert or upsert');
  if(input.columns!==undefined&&!Array.isArray(input.columns))throw new Error('Invalid selected columns');
  const columns=input.columns?.length?input.columns:['*'];
  if(columns.some(col=>typeof col!=='string'||(col!=='*'&&!identifier.test(col))))throw new Error('Invalid selected column');
  if(input.orders!==undefined&&!Array.isArray(input.orders))throw new Error('Invalid order');
  const orders=input.orders||[];
  if(orders.some(order=>!order||typeof order.column!=='string'||!identifier.test(order.column)))throw new Error('Invalid order column');
  if(['insert','update','upsert'].includes(input.operation)){
    const rows=Array.isArray(input.values)?input.values:[input.values];
    if(!input.values||typeof input.values!=='object'||!rows.length||rows.some(row=>!row||typeof row!=='object'||Array.isArray(row)))throw new Error('Write values are required');
    if(input.operation==='update'&&Array.isArray(input.values))throw new Error('Update values must be an object');
  }
  if(input.operation==='upsert'&&(!Array.isArray(input.onConflict)||!input.onConflict.length||input.onConflict.some(col=>typeof col!=='string'||!identifier.test(col))))throw new Error('Upsert conflict columns are required');
  const requestedLimit=Number(input.limit);
  const limit=Number.isFinite(requestedLimit)?Math.max(0,Math.min(DB_QUERY_BATCH_SIZE,Math.floor(requestedLimit))):1000;
  const offset=Math.max(0,Math.min(10_000_000,Math.floor(Number(input.offset)||0)));
  if(input.or!==undefined&&!Array.isArray(input.or))throw new Error('Invalid OR filter');
  if(['insert','upsert'].includes(input.operation)&&(input.or||[]).length)throw new Error('OR filters are not supported for insert or upsert');
  const orFilters=(input.or||[]).map(expr=>{if(typeof expr!=='string')throw new Error('Invalid OR filter');return parsePortableOrExpression(expr)});
  if(orFilters.length>10)throw new Error('Too many OR filters');
  if(input.single!==undefined&&!['single','maybeSingle'].includes(input.single))throw new Error('Invalid row cardinality');
  return {...input,schema,table,filters,columns,orders,limit,offset,orFilters};
}

const GALAXY_BOOLEAN_COLUMNS=new Set(['statics','culture','search','trace','list','keyword','extract','others']);
function containsPredicate(column,term){
  const {fold,pattern}=portableContainsSpec(term);
  return fold
    ?sql`lower(${sql.ref(column)}) like ${pattern} escape '!'`
    :sql`${sql.ref(column)} like ${pattern} escape '!'`;
}
function applyFilters(query,filters){
  for(const filter of filters){
    const op=operators[filter.operator],column=checkedFilterColumn(filter.column);
    const value=GALAXY_BOOLEAN_COLUMNS.has(filter.column)&&
      (filter.value==='true'||filter.value==='false')
      ?filter.value==='true':filter.value;
    if(filter.operator==='in')query=filter.negate?query.where(eb=>eb.not(eb(column,'in',value))):query.where(column,'in',value);
    else if(filter.operator==='ilike')query=query.where(sql`lower(${typeof column==='string'?sql.ref(column):column})`,filter.negate?'not like':'like',String(value).toLowerCase());
    else if(filter.operator==='contains')query=query.where(filter.negate
      ?sql`not (${containsPredicate(column,value)})`:containsPredicate(column,value));
    else if(filter.operator==='is')query=query.where(column,value===null?(filter.negate?'is not':'is'):(filter.negate?'!=':'='),value);
    else query=filter.negate?query.where(eb=>eb.not(eb(column,op,value))):query.where(column,op,value);
  }
  return query;
}

function applyOrFilters(query,groups){
  const predicate=(eb,node)=>{
    if(node.type==='and')return eb.and(node.items.map(item=>predicate(eb,item)));
    if(node.type==='or')return eb.or(node.items.map(item=>predicate(eb,item)));
    if(node.operator==='ilike')return eb(sql`lower(${sql.ref(node.column)})`,'like',String(node.value).toLowerCase());
    if(node.operator==='contains')return containsPredicate(node.column,node.value);
    if(node.operator==='is'&&node.value!==null)return eb(node.column,'=',node.value);
    return eb(node.column,operators[node.operator],node.value);
  };
  for(const group of groups)query=query.where(eb=>predicate(eb,group));
  return query;
}

const PRIVATE_SITES=['messenger','chatgpt','claude','gemini','msn','whatsapp',
  'telegram','discord','line','wechat','teams','copilot','grok','perplexity','meta ai','meta-ai',
  'mcp','github'];
const PUBLIC_ANCHOR_TYPES=['date','period','era','point','path','trace','image','video','rune','suno'];
function databaseTable(req,dialect,namespace,modelName=''){
  // ZenStack PolicyPlugin maps a fixed logical model to the physical table.
  if(modelName)return modelName;
  return namespace===undefined?req.schema+'.'+req.table:
    portableRelation(req.table,dialect,namespace);
}
function publishedOnly(query,table,enabled){
  if(!enabled)return query;
  if(table.endsWith('_galaxy'))
    return query.where('search','=',true)
      .where(eb=>eb.or([eb('site','is',null),
        eb(eb.fn('lower',['site']),'not in',PRIVATE_SITES)]));
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
    trx.selectFrom(table).select(req.columns),req.filters),req.orFilters),req.table,publicOnly);
  for(const order of req.orders)query=query.orderBy(order.column,order.ascending===false?'desc':'asc');
  query=query.limit(req.limit).offset(req.offset);
  const countQuery=req.count?publishedOnly(applyOrFilters(applyFilters(
    trx.selectFrom(table).select(trx.fn.countAll().as('count')),req.filters),req.orFilters),
      req.table,publicOnly):null;
  return {request:req,query:req.head?null:query,countQuery};
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
  if(dialect==='mysql'){
    const duplicateUpdates=req.ignoreDuplicates||!updateColumns.length
      ?Object.fromEntries(req.onConflict.map(col=>[col,sql.ref(col)]))
      :Object.fromEntries(updateColumns.map(col=>[col,sql`values(${sql.ref(col)})`]));
    return trx.insertInto(table).values(req.values).onDuplicateKeyUpdate(duplicateUpdates);
  }
  if(dialect==='mssql'){
    const columns=Object.keys(rows[0]);
    let source=trx.selectNoFrom(columns.map(col=>sql`${sql.val(rows[0][col])}`.as(col)));
    for(const row of rows.slice(1))
      source=source.unionAll(trx.selectNoFrom(columns.map(col=>sql`${sql.val(row[col])}`.as(col))));
    let query=trx.mergeInto(table).using(source.as('source'),join=>{
      let condition=join.onRef(`${table}.${req.onConflict[0]}`,'=','source.'+req.onConflict[0]);
      for(const col of req.onConflict.slice(1))condition=condition.onRef(`${table}.${col}`,'=','source.'+col);
      return condition;
    });
    if(!req.ignoreDuplicates&&updateColumns.length)
      query=query.whenMatched().thenUpdateSet(eb=>Object.fromEntries(
        updateColumns.map(col=>[col,eb.ref('source.'+col)])));
    return query.whenNotMatched().thenInsertValues(eb=>Object.fromEntries(
      columns.map(col=>[col,eb.ref('source.'+col)])));
  }
  // PostgreSQL and SQLite: excluded.<column> represents EACH incoming row.
  // Reusing rows[0] here silently overwrote multi-row upserts with the
  // first row's values. Kysely supports the native excluded reference.
  return trx.insertInto(table).values(req.values).onConflict(oc=>updateColumns.length&&!req.ignoreDuplicates
    ?oc.columns(req.onConflict).doUpdateSet(eb=>Object.fromEntries(
      updateColumns.map(col=>[col,eb.ref('excluded.'+col)])))
    :oc.columns(req.onConflict).doNothing());
}

function applyMutationReturning(query,req,dialect){
  if(!req.returning)return query;
  if(dialect==='mssql'){
    const prefix=req.operation==='delete'?'deleted':'inserted';
    return query.output(req.columns.map(column=>sql.ref(`${prefix}.${column}`).as(column)));
  }
  if(dialect==='mysql')return query;
  return query.returning(req.columns);
}

export function buildKyselyMutationQuery(trx,input,{dialect='postgres',namespace}={}){
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
  const fullTable=databaseTable(req,dialect,namespace);
  if(!['insert','update','delete','upsert'].includes(req.operation))throw new Error('Unsupported mutation');
  let query;
  if(req.operation==='insert')query=trx.insertInto(fullTable).values(req.values);
  if(req.operation==='upsert')query=buildKyselyUpsertQuery(trx,req,dialect,namespace);
  if(req.operation==='update')query=trx.updateTable(fullTable).set(req.values);
  if(req.operation==='delete')query=trx.deleteFrom(fullTable);
  query=applyOrFilters(applyFilters(query,req.filters),req.orFilters);
  return {request:req,query:applyMutationReturning(query,req,dialect)};
}

function whereKeys(query,columns,keys){
  if(!columns.length||!keys.length)return query.where(sql`1 = 0`);
  return query.where(eb=>eb.or(keys.map(key=>eb.and(columns.map(column=>key[column]===null
    ?eb(column,'is',null)
    :eb(column,'=',key[column]))))));
}

async function mysqlPrimaryKeyColumns(trx,req){
  const result=await sql`
    select COLUMN_NAME as column_name
    from information_schema.KEY_COLUMN_USAGE
    where TABLE_SCHEMA = database()
      and TABLE_NAME = ${req.table}
      and CONSTRAINT_NAME = 'PRIMARY'
    order by ORDINAL_POSITION
  `.execute(trx);
  const columns=result.rows.map(row=>String(row.column_name));
  if(!columns.length)throw new Error('MySQL returning needs a primary key');
  return columns;
}

async function executeMysqlReturningMutation(trx,req,query,namespace){
  const fullTable=databaseTable(req,'mysql',namespace);
  if(req.operation==='delete'){
    const before=await applyOrFilters(applyFilters(trx.selectFrom(fullTable).select(req.columns),req.filters),req.orFilters).execute();
    await query.execute();
    return before;
  }
  let keys=[];let keyColumns=[];
  if(req.operation==='update'){
    keyColumns=await mysqlPrimaryKeyColumns(trx,req);
    const existing=await applyOrFilters(applyFilters(trx.selectFrom(fullTable).select(keyColumns),req.filters),req.orFilters).execute();
    keys=existing;
    await query.execute();
  }else{
    const result=await query.execute();
    keyColumns=req.operation==='upsert'?req.onConflict:await mysqlPrimaryKeyColumns(trx,req);
    const values=Array.isArray(req.values)?req.values:[req.values];
    keys=values.filter(row=>keyColumns.every(column=>Object.hasOwn(row,column)));
    if(!keys.length&&req.operation==='insert'&&keyColumns.length===1&&result[0]?.insertId!==undefined){
      keys=[{[keyColumns[0]]:result[0].insertId}];
    }
    if(keys.length!==values.length&&req.operation==='insert'){
      const rowColumns=[...new Set(values.flatMap(row=>Object.keys(row)))];
      if(values.some(row=>rowColumns.some(column=>!Object.hasOwn(row,column))))throw new Error('MySQL returning needs consistent insert columns');
      const returned=await whereKeys(trx.selectFrom(fullTable).select(req.columns),rowColumns,values)
        .orderBy(keyColumns[0],'asc').execute();
      if(returned.length!==values.length)throw new Error('MySQL could not identify every inserted row for RETURNING');
      return returned;
    }
    if(keys.length!==values.length)throw new Error('MySQL returning needs each row primary key');
  }
  return whereKeys(trx.selectFrom(fullTable).select(req.columns),keyColumns,keys).execute();
}

export async function executeKyselyQuery(trx,input,{dialect='postgres',namespace,publicOnly=false,modelName=''}={}){
  const req=validateQuery(input);let data=null,count=null;
  if(req.operation==='select'){
    const built=buildKyselySelectQuery(trx,input,{dialect,namespace,publicOnly,modelName});
    if(built.countQuery){const row=await built.countQuery.executeTakeFirstOrThrow();count=Number(row.count)}
    if(built.query)data=await built.query.execute();
  }else{
    const built=buildKyselyMutationQuery(trx,input,{dialect,namespace});
    if(dialect==='mysql'&&req.returning)data=await executeMysqlReturningMutation(trx,built.request,built.query,namespace);
    else {
      const result=await built.query.execute();
      if(req.returning)data=result;
      else {const affected=result[0]?.numAffectedRows??result[0]?.numInsertedOrUpdatedRows??result[0]?.numUpdatedRows??result[0]?.numDeletedRows??0n;count=Number(affected)}
    }
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
export function isKyselyClientError(error){return error instanceof Error&&['Invalid','Unsupported','Unfiltered','Write','Update','Unexpected','RPC','Schema','Too many','Malformed','Filters','OR filters','Neon theme','MySQL returning','Missing'].some(prefix=>error.message.startsWith(prefix))}
