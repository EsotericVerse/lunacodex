import {sql} from 'kysely';
import {serializePortableJsonFields,portableRelation} from './sql-engine-ports.mjs';
import {validateLocRegistryDomain} from './loc-domain.mjs';
import {portableContainsSpec,parsePortableOrExpression} from './portable-search.mjs';
import {verifyModeledSqlFields,normalizeModeledTypeDifferences,
  normalizeModeledSelectRows} from '../../../zenstack/model-column-guard.mjs';
import {assertKyselyQueryShape,QUERY_FILTER_SQL}
  from '../../../zenstack/sql-input-shape.mjs';
import {ANCHOR_TYPE_GROUPS} from '../../../zenstack/anchor-hierarchy.mjs';

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

function containsPredicate(column,term){
  const {fold,pattern}=portableContainsSpec(term);
  return fold
    ?sql`lower(${sql.ref(column)}) like ${pattern} escape '!'`
    :sql`${sql.ref(column)} like ${pattern} escape '!'`;
}
function applyFilters(query,filters){
  for(const filter of filters){
    const op=operators[filter.operator],column=checkedFilterColumn(filter.column);
    const value=filter.value;
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
const PUBLIC_ANCHOR_TYPES=[...ANCHOR_TYPE_GROUPS.time,...ANCHOR_TYPE_GROUPS.space,
  ...ANCHOR_TYPE_GROUPS.media];
function databaseTable(req,dialect,namespace,modelName=''){
  // ZenStack PolicyPlugin maps a fixed logical model to the physical table.
  if(modelName)return modelName;
  return namespace===undefined?req.schema+'.'+req.table:
    portableRelation(req.table,dialect,namespace);
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
    trx.selectFrom(table).select(req.columns),req.filters),req.orFilters),req.table,publicOnly,req.columns);
  if(req.federatedNullsLast===true&&req.orders.length===1&&
     ['date','createtime'].includes(req.orders[0].column)){
    const sortColumn=req.orders[0].column;
    // Keep NULL dates after real dates in PostgreSQL.
    query=query.orderBy(sql`case when ${sql.ref(sortColumn)} is null then 1 else 0 end`,'asc');
  }
  for(const order of req.orders)query=query.orderBy(order.column,order.ascending===false?'desc':'asc');
  if(req.limit!==null)query=query.limit(req.limit);
  query=query.offset(req.offset);
  const countQuery=req.count?publishedOnly(applyOrFilters(applyFilters(
    trx.selectFrom(table).select(trx.fn.countAll().as('count')),req.filters),req.orFilters),
      req.table,publicOnly,req.columns):null;
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
  // PostgreSQL: excluded.<column> represents EACH incoming row.
  // Reusing rows[0] here silently overwrote multi-row upserts with the
  // first row's values. Kysely supports the native excluded reference.
  return trx.insertInto(table).values(req.values).onConflict(oc=>updateColumns.length&&!req.ignoreDuplicates
    ?oc.columns(req.onConflict).doUpdateSet(eb=>Object.fromEntries(
      updateColumns.map(col=>[col,eb.ref('excluded.'+col)])))
    :oc.columns(req.onConflict).doNothing());
}

function applyMutationReturning(query,req){
  return req.returning?query.returning(req.columns):query;
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
  query=applyOrFilters(applyFilters(query,req.filters),req.orFilters);
  return {request:req,query:applyMutationReturning(query,req,dialect)};
}

/**
 * @param {any} trx
 * @param {any} input
 * @param {{dialect?:string, namespace?:string, publicOnly?:boolean, modelName?:string}} [options]
 */
export async function executeKyselyQuery(trx,input,{dialect='postgres',namespace,publicOnly=false,modelName=''}={}){
  const req=validateQuery(input);let data=null,count=null;
  if(req.operation==='select'){
    const built=buildKyselySelectQuery(trx,input,{dialect,namespace,publicOnly,modelName});
    if(built.countQuery){const row=await built.countQuery.executeTakeFirstOrThrow();count=Number(row.count)}
    if(built.query)data=normalizeModeledSelectRows({
      schema:req.schema,table:req.table,rows:await built.query.execute()
    });
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
