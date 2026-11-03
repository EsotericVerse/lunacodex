import {sql} from 'npm:kysely@0.29.6';
import {DB_QUERY_BATCH_SIZE} from '../query-batch-size.mjs';

const identifier=/^[a-z][a-z0-9_]*$/i;
const schemas=new Set(['silver','api']);
const operators={eq:'=',neq:'!=',gt:'>',gte:'>=',lt:'<',lte:'<=',like:'like',ilike:'ilike',is:'is',in:'in'};
function checkedFilterColumn(value){
  return checkedIdentifier(value,'filter column');
}

// Existing application RPCs only. Keep SQL identifiers fixed and bind all values.
export const RPC_ALLOWLIST={
  'silver.management_write':['p_table','p_operation','p_rows','p_values','p_filters'],
  'silver.read_scope_analytics':['p_scope_id','p_view','p_start','p_end','p_options'],
  // Management is authorized through the unified silver.manage(type,id) RPC.
  // Public Search reads only the persisted summary; it cannot call this RPC.
  'silver.refresh_scope_search_summary':['p_scope_id'],
  'silver.manage':['p_type','p_id'],
  'silver.loc_admin_settings':['p_section','p_operation','p_key','p_value'],
  // These existing scope procedures perform database-side permission checks,
  // atomic multi-row writes, or bounded indexed lookups. Do not recreate
  // transactions as multiple browser requests.
  'silver.import_shared_keyword_class':['p_target_scope','p_source_scope','p_class_uid'],
  'silver.merge_scope_trace_place_names':['p_scope_id','p_keep_uid','p_remove_uids'],
  'silver.save_scope_trace_place_names':['p_scope_id','p_uid','p_names'],
  'silver.scope_type_attr':['p_scope_id','p_type','p_attr'],
  'silver.scope_group':['p_group_id','p_type'],
  'silver.search_scope_trace_place_names':['p_scope_id','p_term','p_limit'],
  'silver.is_current_email_blocklisted':[],
  'silver.move_scope_block':['p_scope_id','p_page_name','p_uid','p_direction'],
  'silver.delete_scope':['p_scope_id'],
  'silver.provision_scope':['p_scope_id','p_display_name','p_email','p_birthday','p_domain','p_directory','p_parent_scope_id','p_theme','p_copy_keywords'],
  'silver.manage_scope_registry':['p_operation','p_scope_id','p_values'],
  'silver.log_search_keyword':['p_scope_id','p_query_text'],
  'silver.read_scope_page_copy':['p_scope_id'],
};
const RPC_REQUIRED_ARGUMENTS={
  'silver.management_write':['p_table','p_operation'],
  'silver.read_scope_analytics':['p_scope_id','p_view'],
  'silver.refresh_scope_search_summary':['p_scope_id'],
  'silver.loc_admin_settings':['p_section'],
  'silver.import_shared_keyword_class':['p_target_scope','p_source_scope','p_class_uid'],
  'silver.save_scope_trace_place_names':['p_scope_id','p_uid','p_names'],
  'silver.scope_type_attr':['p_scope_id','p_type','p_attr'],
  'silver.scope_group':['p_group_id','p_type'],
  'silver.manage':['p_type'],
  'silver.search_scope_trace_place_names':['p_scope_id','p_term'],
  'silver.move_scope_block':['p_scope_id','p_page_name','p_uid','p_direction'],
  'silver.delete_scope':['p_scope_id'],
  'silver.provision_scope':['p_scope_id','p_display_name','p_email'],
  'silver.manage_scope_registry':['p_operation','p_scope_id'],
  'silver.log_search_keyword':['p_scope_id','p_query_text'],
  'silver.read_scope_page_copy':['p_scope_id'],
};

function checkedIdentifier(value,label){
  if(typeof value!=='string'||!identifier.test(value))throw new Error('Invalid '+label);
  return value;
}

function splitExpression(expression){
  const parts=[];let start=0,quoted=false,escaped=false,depth=0;
  for(let i=0;i<expression.length;i++){
    const char=expression[i];
    if(escaped){escaped=false;continue;}
    if(char==='\\'&&quoted){escaped=true;continue;}
    if(char==='"')quoted=!quoted;
    else if(!quoted&&char==='(')depth++;
    else if(!quoted&&char===')'){if(--depth<0)throw new Error('Malformed OR filter');}
    else if(!quoted&&depth===0&&char===','){parts.push(expression.slice(start,i));start=i+1;}
  }
  if(quoted||escaped||depth!==0)throw new Error('Malformed OR filter');
  parts.push(expression.slice(start));
  if(!parts.length||parts.length>30||parts.some(part=>!part.trim()))throw new Error('Invalid OR filter size');
  return parts;
}

function parseExpressionTerm(raw,depth=0){
  if(depth>8)throw new Error('OR filter nesting is too deep');
  const part=raw.trim();
  const group=part.match(/^(and|or)\(([\s\S]*)\)$/i);
  if(group)return {type:group[1].toLowerCase(),items:splitExpression(group[2]).map(item=>parseExpressionTerm(item,depth+1))};
  const match=part.match(/^([a-z][a-z0-9_]*)\.(eq|neq|gt|gte|lt|lte|like|ilike|is)\.(?:"((?:\\.|[^"])*)"|([^,]*))$/i);
  if(!match)throw new Error('Unsupported OR filter');
  const rawValue=match[3]!==undefined?match[3].replace(/\\(["\\])/g,'$1'):match[4];
  const value=rawValue==='true'?true:rawValue==='false'?false:rawValue==='null'?null:/^-?\d+(?:\.\d+)?$/.test(rawValue)?Number(rawValue):rawValue;
  return {type:'predicate',column:checkedIdentifier(match[1],'OR filter column'),operator:match[2].toLowerCase(),value};
}

function parseOrExpression(expression){
  return {type:'or',items:splitExpression(expression).map(parseExpressionTerm)};
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
  const orFilters=(input.or||[]).map(expr=>{if(typeof expr!=='string')throw new Error('Invalid OR filter');return parseOrExpression(expr)});
  if(orFilters.length>10)throw new Error('Too many OR filters');
  if(input.single!==undefined&&!['single','maybeSingle'].includes(input.single))throw new Error('Invalid row cardinality');
  return {...input,schema,table,filters,columns,orders,limit,offset,orFilters};
}

function applyFilters(query,filters){
  for(const filter of filters){
    const op=operators[filter.operator],column=checkedFilterColumn(filter.column);
    if(filter.operator==='in')query=filter.negate?query.where(eb=>eb.not(eb(column,'in',filter.value))):query.where(column,'in',filter.value);
    else if(filter.operator==='ilike')query=query.where(sql`lower(${typeof column==='string'?sql.ref(column):column})`,filter.negate?'not like':'like',String(filter.value).toLowerCase());
    else if(filter.operator==='is')query=query.where(column,filter.value===null?(filter.negate?'is not':'is'):(filter.negate?'!=':'='),filter.value);
    else query=filter.negate?query.where(eb=>eb.not(eb(column,op,filter.value))):query.where(column,op,filter.value);
  }
  return query;
}

function applyOrFilters(query,groups){
  const predicate=(eb,node)=>{
    if(node.type==='and')return eb.and(node.items.map(item=>predicate(eb,item)));
    if(node.type==='or')return eb.or(node.items.map(item=>predicate(eb,item)));
    if(node.operator==='ilike')return eb(sql`lower(${sql.ref(node.column)})`,'like',String(node.value).toLowerCase());
    if(node.operator==='is'&&node.value!==null)return eb(node.column,'=',node.value);
    return eb(node.column,operators[node.operator],node.value);
  };
  for(const group of groups)query=query.where(eb=>predicate(eb,group));
  return query;
}

export function buildKyselySelectQuery(trx,input){
  const req=validateQuery(input);
  if(req.operation!=='select')throw new Error('Unsupported operation for SELECT builder');
  const table=`${req.schema}.${req.table}`;
  let query=applyOrFilters(applyFilters(trx.selectFrom(table).select(req.columns),req.filters),req.orFilters);
  for(const order of req.orders)query=query.orderBy(order.column,order.ascending===false?'desc':'asc');
  query=query.limit(req.limit).offset(req.offset);
  const countQuery=req.count?applyOrFilters(applyFilters(trx.selectFrom(table).select(trx.fn.countAll().as('count')),req.filters),req.orFilters):null;
  return {request:req,query:req.head?null:query,countQuery};
}

function sameKeys(rows){
  const keys=Object.keys(rows[0]||{}).sort().join('\0');
  return rows.every(row=>Object.keys(row).sort().join('\0')===keys);
}

export function buildKyselyUpsertQuery(trx,req,dialect='postgres'){
  const rows=Array.isArray(req.values)?req.values:[req.values];
  if(!sameKeys(rows))throw new Error('Upsert rows must have the same columns');
  const table=`${req.schema}.${req.table}`;
  const updates=Object.fromEntries(Object.keys(rows[0]||{}).filter(col=>!req.onConflict.includes(col)).map(col=>[col,rows[0][col]]));
  if(dialect==='mysql'){
    const duplicateUpdates=req.ignoreDuplicates||!Object.keys(updates).length
      ?Object.fromEntries(req.onConflict.map(col=>[col,sql.ref(col)]))
      :Object.fromEntries(Object.keys(updates).map(col=>[col,sql`values(${sql.ref(col)})`]));
    return trx.insertInto(table).values(req.values).onDuplicateKeyUpdate(duplicateUpdates);
  }
  if(dialect==='mssql'){
    let source=trx.selectNoFrom(Object.keys(rows[0]).map(col=>sql`${sql.val(rows[0][col])}`.as(col)));
    for(const row of rows.slice(1))source=source.unionAll(trx.selectNoFrom(Object.keys(rows[0]).map(col=>sql`${sql.val(row[col])}`.as(col))));
    let query=trx.mergeInto(table).using(source.as('source'),join=>{
      let condition=join.onRef(`${table}.${req.onConflict[0]}`,'=','source.'+req.onConflict[0]);
      for(const col of req.onConflict.slice(1))condition=condition.onRef(`${table}.${col}`,'=','source.'+col);
      return condition;
    });
    if(!req.ignoreDuplicates&&Object.keys(updates).length)query=query.whenMatched().thenUpdateSet(eb=>Object.fromEntries(Object.keys(updates).map(col=>[col,eb.ref('source.'+col)])));
    return query.whenNotMatched().thenInsertValues(req.values);
  }
  return trx.insertInto(table).values(req.values).onConflict(oc=>Object.keys(updates).length&&!req.ignoreDuplicates
    ?oc.columns(req.onConflict).doUpdateSet(updates)
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

export function buildKyselyMutationQuery(trx,input,{dialect='postgres'}={}){
  const req=validateQuery(input);const fullTable=`${req.schema}.${req.table}`;
  if(!['insert','update','delete','upsert'].includes(req.operation))throw new Error('Unsupported mutation');
  let query;
  if(req.operation==='insert')query=trx.insertInto(fullTable).values(req.values);
  if(req.operation==='upsert')query=buildKyselyUpsertQuery(trx,req,dialect);
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
    where TABLE_SCHEMA = ${req.schema}
      and TABLE_NAME = ${req.table}
      and CONSTRAINT_NAME = 'PRIMARY'
    order by ORDINAL_POSITION
  `.execute(trx);
  const columns=result.rows.map(row=>String(row.column_name));
  if(!columns.length)throw new Error('MySQL returning needs a primary key');
  return columns;
}

async function executeMysqlReturningMutation(trx,req,query){
  const fullTable=`${req.schema}.${req.table}`;
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

export async function executeKyselyQuery(trx,input,{dialect='postgres'}={}){
  const req=validateQuery(input);let data=null,count=null;
  if(req.operation==='select'){
    const built=buildKyselySelectQuery(trx,input);
    if(built.countQuery){const row=await built.countQuery.executeTakeFirstOrThrow();count=Number(row.count)}
    if(built.query)data=await built.query.execute();
  }else{
    const built=buildKyselyMutationQuery(trx,input,{dialect});
    if(dialect==='mysql'&&req.returning)data=await executeMysqlReturningMutation(trx,req,built.query);
    else {
      const result=await built.query.execute();
      if(req.returning)data=result;
      else {const affected=result[0]?.numAffectedRows??result[0]?.numInsertedOrUpdatedRows??result[0]?.numUpdatedRows??result[0]?.numDeletedRows??0n;count=Number(affected)}
    }
  }
  if(req.single){const rows=Array.isArray(data)?data:[];if(rows.length>1||(req.single==='single'&&rows.length!==1))throw Object.assign(new Error('Row count mismatch'),{code:'PGRST116'});data=rows[0]||null}
  return {data,count};
}

export function buildAllowlistedRpcQuery(input){
  if(!input||input.kind!=='rpc')throw new Error('Invalid request kind');
  const schema=checkedIdentifier(input.schema,'RPC schema');const name=checkedIdentifier(input.name,'RPC name');
  const key=`${schema}.${name}`;const names=RPC_ALLOWLIST[key];if(!names)throw new Error('RPC is not enabled');
  const args=input.args&&typeof input.args==='object'&&!Array.isArray(input.args)?input.args:{};
  if(Object.keys(args).some(arg=>!names.includes(arg)))throw new Error('Unexpected RPC argument');
  if((RPC_REQUIRED_ARGUMENTS[key]||[]).some(arg=>!Object.hasOwn(args,arg)))throw new Error('Missing required RPC argument');
  const supplied=names.filter(name=>Object.hasOwn(args,name));const id=sql.id(schema,name);
  // management_write accepts JSONB payloads. pg encodes native JS arrays
  // as PostgreSQL array literals, which are invalid JSONB (SQLSTATE 22P02).
  // Serialize only these declared JSONB arguments; other RPCs can legitimately
  // accept PostgreSQL arrays. Keep null as SQL NULL, not JSONB 'null'.
  // A JS array is a PostgreSQL array by default. These existing procedures
  // accept JSONB arrays, whereas name lists and place UID lists are SQL arrays.
  const jsonbArgsByRpc={
    'silver.management_write':new Set(['p_rows','p_values','p_filters']),
    'silver.loc_admin_settings':new Set(['p_value']),
    'silver.read_scope_analytics':new Set(['p_options']),
    'silver.scope_type_attr':new Set(['p_attr']),
  };
  const jsonbArgs=jsonbArgsByRpc[key];
  const params=supplied.map(name=>{
    const value=args[name];
    const parameter=jsonbArgs?.has(name)
      ?sql`${sql.val(value==null?null:JSON.stringify(value))}::jsonb`
      :sql.val(value);
    return sql`${sql.id(name)} => ${parameter}`;
  });
  const returnsRows=key==='silver.read_scope_page_copy'||key==='silver.manage';
  return {query:returnsRows?sql`select * from ${id}(${sql.join(params)})`:sql`select ${id}(${sql.join(params)}) as result`,returnsRows};
}

export async function executeAllowlistedRpc(trx,input){
  const {query,returnsRows}=buildAllowlistedRpcQuery(input);const result=await query.execute(trx);
  return {data:returnsRows?result.rows:result.rows[0]?.result??null,count:null};
}

export function isKyselyClientError(error){return error instanceof Error&&['Invalid','Unsupported','Unfiltered','Write','Update','Unexpected','RPC','Schema','Too many','Malformed','Filters','OR filters','Neon theme','MySQL returning','Missing'].some(prefix=>error.message.startsWith(prefix))}
