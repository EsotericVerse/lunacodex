// Lossless subset of LOC query/select translated to native ZenStack V3 ORM.
// Auth/Scope, public visibility, and database selection are checked by Gateway.
import {schema} from './schema.mjs';

const SCOPED={Galaxy:'Lo3rwangGalaxy',Anchor:'Lo3rwangAnchor',Blocks:'Lo3rwangBlocks'};
const OPS={eq:'equals',neq:'not',gt:'gt',gte:'gte',lt:'lt',lte:'lte',in:'in'};

function matchingValue(field,value){
  if(value===null)return Boolean(field.optional);
  if(field.array)return false;
  if(field.type==='String')return typeof value==='string';
  if(field.type==='Boolean')return typeof value==='boolean';
  if(field.type==='Int')return Number.isSafeInteger(value);
  if(field.type==='BigInt')return typeof value==='bigint';
  if(field.type==='DateTime')return value instanceof Date&&!Number.isNaN(value.getTime());
  return false;
}
export function nativeReadPlan(body,modelName){
  const model=schema.models[modelName]||schema.models[SCOPED[modelName]];
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
      if(!Array.isArray(item.value)||item.value.some(v=>v===null||!matchingValue(field,v)))return null;
    }else if(!matchingValue(field,item.value))return null;
    filters.push({[item.column]:{
      [item.operator==='is'?'equals':OPS[item.operator]]:item.value
    }});
  }
  const orderBy=[];
  for(const item of body.orders||[]){
    if(!item||!Object.hasOwn(fields,item.column))return null;
    orderBy.push({[item.column]:item.ascending===false?'desc':'asc'});
  }
  if(body.single!==undefined&&!['single','maybeSingle'].includes(body.single))
    return null;
  const limit=body.limit==null?null:Number(body.limit);
  const offset=body.offset==null?0:Number(body.offset);
  if(limit!==null&&(!Number.isSafeInteger(limit)||limit<0)||
    !Number.isSafeInteger(offset)||offset<0)return null;
  return {
    select:Object.fromEntries(body.columns.map(c=>[c,true])),
    where:filters.length?{AND:filters}:{},
    orderBy,
    ...(limit===null?{}:{take:limit}),
    skip:offset,
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
  const count=plan.count?Number(await delegate.count({where:plan.where})):null;
  const data=plan.head?null:await delegate.findMany({
    where:plan.where,select:plan.select,orderBy:plan.orderBy,
    skip:plan.skip,take:plan.take
  });
  if(!plan.single)return {data,count};
  const rows=data||[];
  if(rows.length>1||plan.single==='single'&&rows.length!==1)
    throw Object.assign(new Error('Row count mismatch'),{code:'PGRST116'});
  return {data:rows[0]||null,count};
}
