// Lossless subset of LOC query/select translated to native ZenStack V3 ORM.
// Auth/Scope, public visibility, and database selection are checked by Gateway.
import {schema} from './schema.mjs';

const SCOPED={Galaxy:'Lo3rwangGalaxy',Anchor:'Lo3rwangAnchor',Blocks:'Lo3rwangBlocks'};
const OPS={eq:'equals',neq:'not',gt:'gt',gte:'gte',lt:'lt',lte:'lte',in:'in'};

// Only lossless scalar coercions enter ZenStack's typed ORM. The browser
// serializes dates and boolean query values as strings; rejecting all of them
// previously sent ordinary Culture/Search predicates to custom SQL.
const UNSUPPORTED=Symbol('unsupported native LOC filter');
function typedValue(field,value){
  if(value===null)return field.optional?null:UNSUPPORTED;
  if(field.array)return UNSUPPORTED;
  if(field.type==='String')return typeof value==='string'?value:UNSUPPORTED;
  if(field.type==='Boolean'){
    if(typeof value==='boolean')return value;
    if(value==='true')return true;
    if(value==='false')return false;
    return UNSUPPORTED;
  }
  if(field.type==='Int')return Number.isSafeInteger(value)?value:UNSUPPORTED;
  if(field.type==='BigInt')return typeof value==='bigint'?value:UNSUPPORTED;
  if(field.type==='DateTime'){
    if(value instanceof Date)return Number.isNaN(value.getTime())?UNSUPPORTED:value;
    if(typeof value!=='string')return UNSUPPORTED;
    const types=new Set((field.attributes||[]).map(attribute=>attribute.name));
    // A PostgreSQL DATE has no time zone. A strict calendar day maps to UTC
    // midnight without accepting JS Date's overflow normalization (Feb 30).
    if(types.has('@db.Date')&&/^\d{4}-\d{2}-\d{2}$/.test(value)){
      const date=new Date(value+'T00:00:00.000Z');
      return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===value
        ?date:UNSUPPORTED;
    }
    // Timestamp with time zone: an explicit offset is mandatory. Untz local
    // timestamps keep the existing Kysely path to preserve their semantics.
    if(types.has('@db.Timestamptz')&&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)){
      const date=new Date(value);
      return Number.isNaN(date.getTime())?UNSUPPORTED:date;
    }
  }
  return UNSUPPORTED;
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
      !(item.operator==='is'||OPS[item.operator]))return null;
    const field=fields[item.column];
    if(['gt','gte','lt','lte'].includes(item.operator)&&
      !['String','Int','BigInt','DateTime'].includes(field.type))return null;
    if(item.operator==='is'&&item.value!==null&&
      field.type!=='Boolean')return null;
    let value;
    if(item.operator==='in'){
      if(!Array.isArray(item.value))return null;
      value=[];
      for(const itemValue of item.value){
        const normalized=typedValue(field,itemValue);
        if(normalized===UNSUPPORTED||normalized===null)return null;
        value.push(normalized);
      }
    }else{
      value=typedValue(field,item.value);
      if(value===UNSUPPORTED)return null;
    }
    filters.push({[item.column]:{
      [item.operator==='is'?'equals':OPS[item.operator]]:value
    }});
  }
  const orderBy=[];
  for(const item of body.orders||[]){
    // Prisma-like orderBy cannot express the caller's explicit NULLS FIRST.
    if(!item||!Object.hasOwn(fields,item.column)||
      item.nullsFirst!==undefined)return null;
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
