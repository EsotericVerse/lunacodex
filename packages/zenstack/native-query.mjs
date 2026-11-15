// Lossless subset of LOC query/select translated to native ZenStack V3 ORM.
// Auth/Scope, public visibility, and database selection are checked by Gateway.
import {createQuerySchemaFactory} from '@zenstackhq/orm';
import {schema} from './schema.mjs';

const SCOPED={Galaxy:'Lo3rwangGalaxy',Anchor:'Lo3rwangAnchor',Blocks:'Lo3rwangBlocks'};
const modelForName=name=>schema.models[name]||schema.models[SCOPED[name]];
const querySchemaFactory=createQuerySchemaFactory(schema);
const queryModelForName=name=>SCOPED[name]||name;
// PostgreSQL DATE is returned by Kysely as YYYY-MM-DD but ZenStack V3
// exposes @db.Date through DateTime. Preserve the existing HTTP value shape
// instead of silently returning ISO timestamps to Culture/Statistics.
function nativeDateColumns(modelName){
  const model=modelForName(modelName);
  return Object.entries(model?.fields||{}).filter(([,field])=>
    field.attributes?.some(attr=>attr.name==='@db.Date')).map(([key])=>key);
}
export function projectNativeSqlDateRows(rows,modelName){
  if(!Array.isArray(rows)||!rows.length)return rows;
  const columns=nativeDateColumns(modelName);
  if(!columns.length)return rows;
  return rows.map(row=>{
    let changed=null;
    for(const name of columns){
      if(!Object.hasOwn(row,name)||!(row[name] instanceof Date))continue;
      if(Number.isNaN(row[name].getTime()))continue;
      if(!changed)changed={...row};
      changed[name]=row[name].toISOString().slice(0,10);
    }
    return changed||row;
  });
}
// Kysely's PostgreSQL int8 transport returns decimal text. ZenStack V3
// exposes the same physical BIGINT as a native bigint, which JSON.stringify
// cannot serialize (HTTP 503 without a SQLSTATE). Project *only* modeled
// BigInt fields back to decimal text, preserving all precision and the
// established browser wire contract. Do not coerce arbitrary JSON payloads.
function nativeBigIntColumns(modelName){
  const model=modelForName(modelName);
  return Object.entries(model?.fields||{}).filter(([,field])=>
    field.type==='BigInt'&&!field.array).map(([key])=>key);
}
export function projectNativeSqlBigIntRows(rows,modelName){
  if(!Array.isArray(rows)||!rows.length)return rows;
  const columns=nativeBigIntColumns(modelName);
  if(!columns.length)return rows;
  return rows.map(row=>{
    let projected=null;
    for(const name of columns){
      if(!Object.hasOwn(row,name)||typeof row[name]!=='bigint')continue;
      if(!projected)projected={...row};
      projected[name]=row[name].toString();
    }
    return projected||row;
  });
}

const OPS={eq:'equals',neq:'not',gt:'gt',gte:'gte',lt:'lt',lte:'lte',in:'in'};

// The ORM's generated query schema is the source of truth for modeled
// operators, scalar types, nullability and select shape. Keep this small
// guard only for the two cases where LOC intentionally remains on Kysely:
// nullable list columns and date strings whose existing wire contract must
// not be coerced by Zod.
function nativeFilterValue(field,value){
  if(field.array)return false;
  if(field.type==='DateTime')
    return value instanceof Date&&!Number.isNaN(value.getTime());
  return true;
}

function ormFilter(column,operator,value){
  if(value===null&&(operator==='is'||operator==='eq'))return {[column]:null};
  if(value===null&&operator==='neq')return {[column]:{not:null}};
  return {[column]:{[OPS[operator]]:value}};
}

function parsedFindManyArgs(modelName,filters,columns,orders,limit,offset){
  const where=filters.length?{AND:filters.map(item=>
    ormFilter(item.column,item.operator,item.value))}:{};
  const orderBy=orders.map(item=>({[item.column]:item.ascending===false?'desc':'asc'}));
  const input={
    where,
    select:Object.fromEntries(columns.map(column=>[column,true])),
    skip:offset,
    ...(limit===null?{}:{take:limit}),
    ...(orderBy.length?{orderBy}: {})
  };
  const parsed=querySchemaFactory.makeFindManySchema(queryModelForName(modelName))
    .safeParse(input);
  return parsed.success?parsed.data:null;
}
export function nativeReadPlan(body,modelName){
  const model=modelForName(modelName);
  if(!model||body?.kind!=='query'||body.operation!=='select'||
    !Array.isArray(body.columns)||!body.columns.length||
    !Array.isArray(body.filters??[])||!Array.isArray(body.orders??[])||
    !Array.isArray(body.or??[])||body.or?.length)return null;
  const fields=model.fields;
  // Nullable PostgreSQL list columns do not round-trip losslessly through
  // the frozen ZModel's array metadata. Keep their existing Kysely reader.
  if(body.columns.some(c=>typeof c!=='string'||!Object.hasOwn(fields,c)||
    fields[c].array))return null;
  const filters=[];
  for(const item of body.filters||[]){
    if(!item||!Object.hasOwn(fields,item.column)||item.negate||
      !(item.operator==='is'&&item.value===null||OPS[item.operator]))return null;
    const field=fields[item.column];
    if(item.operator==='in'){
      if(!Array.isArray(item.value)||item.value.some(v=>v===null||
        !nativeFilterValue(field,v)))return null;
    }else if(item.value!==null&&!nativeFilterValue(field,item.value))return null;
    filters.push(item);
  }
  for(const item of body.orders||[]){
    if(!item||!Object.hasOwn(fields,item.column))return null;
  }
  if(body.single!==undefined&&!['single','maybeSingle'].includes(body.single))
    return null;
  const limit=body.limit==null?null:Number(body.limit);
  const offset=body.offset==null?0:Number(body.offset);
  if(limit!==null&&(!Number.isSafeInteger(limit)||limit<0)||
    !Number.isSafeInteger(offset)||offset<0)return null;
  const args=parsedFindManyArgs(modelName,filters,body.columns,body.orders||[],limit,offset);
  if(!args)return null;
  return {
    ...args,
    args,
    head:Boolean(body.head),count:Boolean(body.count),single:body.single
  };
}

/** Runs only AFTER LOC Gateway has authorized the exact target.
 * Fixed models require a PolicyPlugin client; dynamic Scope models use
 * the existing LOC ACL and must not be exposed as a generic raw client.
 */
export async function executeNativeRead(client,body,modelName){
  const plan=nativeReadPlan(body,modelName);
  if(!plan)return null;
  const delegate=client?.[modelName[0].toLowerCase()+modelName.slice(1)];
  if(!delegate||typeof delegate.findMany!=='function'||typeof delegate.count!=='function')
    throw new Error('ZenStack native model is unavailable');
  const count=plan.count?Number(await delegate.count({where:plan.args.where})):null;
  const raw=plan.head?null:await delegate.findMany(plan.args);
  const data=projectNativeSqlBigIntRows(projectNativeSqlDateRows(raw,modelName),modelName);
  if(!plan.single)return {data,count};
  const rows=data||[];
  if(rows.length>1||plan.single==='single'&&rows.length!==1)
    throw Object.assign(new Error('Row count mismatch'),{code:'PGRST116'});
  return {data:rows[0]||null,count};
}
