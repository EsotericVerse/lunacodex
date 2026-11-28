import {planUidDependencyRepair,UID_DEPENDENT_LUCUS_FIELDS} from './uid-dependency-immer.mjs';
import {sql} from 'kysely';
import {PERSISTED_LUCUS_TYPES} from '../../../packages/zenstack/lucus-hierarchy.mjs';
import {DEFAULT_SCOPE_TABLE_SETTINGS,scopeTableName} from '../../../packages/zenstack/scope-table-names.mjs';

const UID=/^[A-Za-z0-9]{8}$/;
const SCOPED=/^([a-z][a-z0-9]{0,14})_(galaxy|lucus)$/;

function failed(){
  const error=new Error('UID 引用修正未完成，已拒絕刪除；請重新載入。');
  error.httpStatus=409;
  throw error;
}
function samePkDeletion(filters){
  if(!Array.isArray(filters)||filters.length<1||filters.length>2)return '';
  const pk=filters.filter(f=>f?.column==='uid'&&(f.operator||'eq')==='eq');
  if(pk.length!==1||!UID.test(String(pk[0].value||'')))return '';
  if(filters.some(f=>f!==pk[0]&&(f.column!=='type'||(f.operator||'eq')!=='eq')))
    return '';
  return pk[0].value;
}
function typedTable(table,engine,namespace){
  return engine==='mysql'?table:(engine==='postgres'?'silver':namespace)+'.'+table;
}
// Exact UID references only. Values and JSON paths are bound as parameters.
// This intentionally never interpolates caller-supplied SQL or identifiers.
function listContains(field,uid,engine,path=''){
  const column=sql.ref(field),jsonPath=path?'$."'+path+'"':'';
  if(engine==='postgres')
    return path?sql`(${column}->${path}) ? ${uid}`
      :sql`${uid} = ANY(${column})`;
  if(engine==='mysql')
    return path?sql`JSON_CONTAINS(JSON_EXTRACT(${column}, ${jsonPath}), JSON_QUOTE(${uid}))`
      :sql`JSON_CONTAINS(${column}, JSON_QUOTE(${uid}))`;
  if(engine==='mssql')
    return path?sql`EXISTS (SELECT 1 FROM OPENJSON(${column}, ${jsonPath}) AS entry WHERE entry.value = ${uid})`
      :sql`EXISTS (SELECT 1 FROM OPENJSON(${column}) AS entry WHERE entry.value = ${uid})`;
  throw new TypeError('Unsupported SQL engine for UID dependency repair');
}

// Only independent, identical-shape scalar nullifications can share an
// UPDATE. JSON/array changes and mixed scalar+array changes retain row CAS.
const SCALAR_UID_REPAIR_COLUMNS=new Set(['source_id','ref_id','place_id']);
export function planUidScalarRepairBatches(updates,deletedUid,{
  maxRows=Number.MAX_SAFE_INTEGER,maxBytes=128*1024,maxParameters=1800
}={}){
  if(!UID.test(String(deletedUid||''))||!Array.isArray(updates)||
      !Number.isSafeInteger(maxRows)||maxRows<1||
      !Number.isSafeInteger(maxBytes)||maxBytes<2||
      !Number.isSafeInteger(maxParameters)||maxParameters<4||maxParameters>32000)
    throw new TypeError('Invalid scalar UID repair batch');
  const grouped=new Map(),singles=[];
  for(const item of updates){
    const fields=Object.keys(item?.values||{}).sort();
    const scalar=fields.length>0&&fields.every(field=>
      SCALAR_UID_REPAIR_COLUMNS.has(field)&&item.values[field]===null&&
      item.expected?.[field]===deletedUid);
    if(!scalar){singles.push(item);continue;}
    const key=fields.join('|');
    if(!grouped.has(key))grouped.set(key,{fields,uids:[]});
    grouped.get(key).uids.push(item.uid);
  }
  const batches=[],encoder=new TextEncoder();
  for(const {fields,uids} of grouped.values()){
    // One NULL SET and one old-value CAS bind per field, plus each UID.
    // Leave headroom below SQL Server's 2100-parameter ceiling.
    const capacity=Math.min(maxRows,maxParameters-2*fields.length);
    if(capacity<1)throw new TypeError('Scalar UID SQL parameter budget exceeded');
    let chunk=[],bytes=2;
    for(const uid of uids){
      const length=encoder.encode(JSON.stringify(uid)).byteLength;
      if(chunk.length&&(chunk.length>=capacity||bytes+1+length>maxBytes)){
        batches.push({fields,uids:chunk});chunk=[];bytes=2;
      }
      bytes+=length+(chunk.length?1:0);
      chunk.push(uid);
    }
    if(chunk.length)batches.push({fields,uids:chunk});
  }
  return {batches,singles};
}

// Kysely compiles this for each engine. The old UID equality is the CAS
// predicate for every changed scalar field, plus the exact candidate PK set.
export function buildUidScalarRepairQuery(db,table,batch,deletedUid,
  serialize=values=>values){
  const values=Object.fromEntries(batch.fields.map(field=>[field,null]));
  let query=db.updateTable(table).set(serialize(values,table))
    .where('uid','in',batch.uids);
  for(const field of batch.fields)query=query.where(field,'=',deletedUid);
  return query;
}


// Bounded, shape-aware CASE batches retain one predicate per affected row.
// Existing SELECT projections and JS graph validation remain authoritative;
// these statements only shorten round-trips inside the authorized transaction.
export function planUidRepairStatementBatches(items,{
  maxRows=Number.MAX_SAFE_INTEGER,maxBytes=128*1024,maxParameters=1800
}={}){
  if(!Array.isArray(items)||!Number.isSafeInteger(maxRows)||maxRows<1||
     !Number.isSafeInteger(maxBytes)||maxBytes<1||
     !Number.isSafeInteger(maxParameters)||maxParameters<8||maxParameters>32000)
    throw new TypeError('Invalid UID dependency statement budget');
  const groups=new Map(),encoder=new TextEncoder();
  for(const item of items){
    if(!UID.test(String(item?.uid||''))||!item?.values||
        !item?.expected||!Object.keys(item.values).length)
      throw new TypeError('Invalid UID repair row');
    const fields=Object.keys(item.values).sort();
    const type=String(item.type||'');
    const key=type+'\0'+fields.join('\0');
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(item);
  }
  const batches=[];
  for(const group of groups.values()){
    let chunk=[],bytes=0,parameters=0;
    for(const item of group){
      const size=encoder.encode(JSON.stringify(item,
        (_,value)=>typeof value==='bigint'?String(value):value)).length;
      // Conservative upper bound for a CASE arm plus its own UID/CAS
      // predicate. SQL Server has 2,100 parameters; allow headroom.
      // PostgreSQL's native array case needs fewer, never more.
      const params=Object.keys(item.values).length*2+1+
        Object.keys(item.expected).length+(item.type?1:0);
      if(chunk.length&&(chunk.length>=maxRows||bytes+size>maxBytes||
          parameters+params>maxParameters)){
        batches.push(chunk);chunk=[];bytes=0;parameters=0;
      }
      chunk.push(item);bytes+=size;parameters+=params;
    }
    if(chunk.length)batches.push(chunk);
  }
  return batches;
}
function uidRepairConditions(eb,items,table,serialize){
  return eb.or(items.map(item=>eb.and([
    eb('uid','=',item.uid),
    ...Object.entries(serialize(item.expected,table)).map(([field,value])=>{
      // Kysely parses a raw JS array as a SQL value tuple, which is NOT a
      // PostgreSQL text[] comparison. Bind the entire old UID list as one
      // typed array parameter to retain exact ordered CAS semantics.
      const comparable=field==='target_id'&&Array.isArray(value)
        ?sql`${value}::text[]`:value;
      return value===null?eb(field,'is',null):eb(field,'=',comparable);
    })
  ])));
}
// CASE values are different for each PK, including Anchor JSON and num.
// Existing engine serializers provide JSON text or PostgreSQL JSONB casts.
// Every PK also carries its OWN old-value predicate for CAS.
export function buildUidCaseRepairQuery(db,table,items,serialize=values=>values){
  if(!Array.isArray(items)||!items.length)
    throw new TypeError('Empty UID repair CASE batch');
  const fields=Object.keys(items[0].values).sort();
  if(items.some(item=>Object.keys(item.values).sort().join('|')!==fields.join('|')))
    throw new TypeError('Mixed UID repair fields');
  const prepared=items.map(item=>serialize(item.values,table));
  const values=Object.fromEntries(fields.map(field=>[
    field,sql`CASE ${sql.ref('uid')} ${sql.join(items.map((item,index)=>
      sql`WHEN ${item.uid} THEN ${prepared[index][field]}`),sql` `)}
      ELSE ${sql.ref(field)} END`
  ]));
  let query=db.updateTable(table).set(values)
    .where(eb=>uidRepairConditions(eb,items,table,serialize));
  if(items[0].type){
    if(items.some(item=>item.type!==items[0].type))
      throw new TypeError('Mixed UID repair Anchor types');
    query=query.where('type','=',items[0].type);
  }
  return query;
}
function nativeArrayRepair(item,deletedUid){
  const fields=Object.keys(item?.values||{});
  return fields.includes('target_id')&&
    Array.isArray(item.values.target_id)&&
    Array.isArray(item.expected?.target_id)&&
    fields.every(field=>field==='target_id'||(
      SCALAR_UID_REPAIR_COLUMNS.has(field)&&item.values[field]===null&&
      item.expected?.[field]===deletedUid));
}
// PostgreSQL array_remove removes ALL matching values, like JS filter.
// Old array/scalar values are still compared exactly in the WHERE clause.
export function buildUidNativeArrayRepairQuery(db,table,items,deletedUid,
  serialize=values=>values){
  if(!Array.isArray(items)||!items.length||
     items.some(item=>!nativeArrayRepair(item,deletedUid)))
    throw new TypeError('Invalid native UID array repair batch');
  const fields=Object.keys(items[0].values).sort();
  if(items.some(item=>Object.keys(item.values).sort().join('|')!==fields.join('|')))
    throw new TypeError('Mixed native UID array repair fields');
  const values=Object.fromEntries(fields.map(field=>[
    field,field==='target_id'
      ?sql`array_remove(${sql.ref('target_id')}, ${deletedUid})`:null
  ]));
  return db.updateTable(table).set(values)
    .where(eb=>uidRepairConditions(eb,items,table,serialize));
}
async function checkRepairBatch(query,expected){
  const result=await query.executeTakeFirst();
  if(Number(result?.numUpdatedRows||0)!==expected)failed();
}

/**
 * Reuse the existing authorized Kysely write connection. No additional
 * transaction, stored function or RPC is created. Read only UID projections
 * (never article bodies); repair precisely changed rows by their own PK.
 */
export async function repairBeforeUidDelete(db,{table,filters,engine='postgres',namespace='silver',
  serialize=(values)=>values}={}){
  const rawTable=String(table||'');
  let match=SCOPED.exec(rawTable);
  if(!match){
    for(const scope of Object.keys(DEFAULT_SCOPE_TABLE_SETTINGS)){
      for(const kind of ['galaxy','lucus']){
        if(scopeTableName(scope,kind)===rawTable){match=[rawTable,scope,kind];break;}
      }
      if(match)break;
    }
  }
  const globalSource=rawTable===scopeTableName('loc','lucus');
  if(!match&&!globalSource)return {affected:0,handled:false};
  const uid=samePkDeletion(filters);
  if(!uid)failed(); // Never silently bypass the guard for broad deletes.
  const owner=match?.[1]||'loc',kind=match?.[2]||'lucus';
  const lucus=typedTable(scopeTableName(globalSource?'loc':owner,'lucus'),engine,namespace);
  const galaxy=globalSource?null:typedTable(scopeTableName(owner,'galaxy'),engine,namespace);
  let deletedType='';
  if(kind==='lucus'){
    const row=await db.selectFrom(lucus).select(['uid','type'])
      .where('uid','=',uid).executeTakeFirst();
    if(!row)return {affected:0,handled:true};
    deletedType=String(row.type||'');
    if(filters.some(f=>f.column==='type'&&f.value!==deletedType))
      return {affected:0,handled:true};
    // LOC Blocks share loc_lucus; they aren't typed source nodes.
    if(globalSource&&!PERSISTED_LUCUS_TYPES.includes(deletedType))
      return {affected:0,handled:true};
  }
  const galaxyColumns=kind==='galaxy'
    ?['uid','source_id','target_id','ref_id']
    :deletedType==='point'?['uid','place_id']:[];
  // Galaxy articles are not stored in Pattern: there are no posting links to repair.
  const parentFields=kind==='galaxy'?{}:UID_DEPENDENT_LUCUS_FIELDS[deletedType]||{};
  const parentTypes=Object.keys(parentFields);
  let galaxyRows=[],lucusRows=[];
  // One narrow SELECT per physical table, only rows mentioning the exact UID.
  // The deleted article is included in the same result to establish existence.
  if(galaxy&&galaxyColumns.length){
    let query=db.selectFrom(galaxy).select(galaxyColumns);
    if(kind==='galaxy'){
      query=query.where(eb=>eb.or([
        eb('uid','=',uid),
        eb('source_id','=',uid),
        eb('ref_id','=',uid),
        listContains('target_id',uid,engine)
      ]));
    }else if(deletedType==='point'){
      query=query.where('place_id','=',uid);
    }
    galaxyRows=await query.execute();
  }
  if(kind==='galaxy'&&!galaxyRows.some(row=>row.uid===uid))
    return {affected:0,handled:true};
  if(parentTypes.length){
    lucusRows=await db.selectFrom(lucus).select(['uid','type','attr'])
      .where(eb=>eb.or(parentTypes.map(type=>eb.and([
        eb('type','=',type),
        listContains('attr',uid,engine,parentFields[type])
      ])))).execute();
  }
  const plan=planUidDependencyRepair({deletedUid:uid,deletedTable:kind,
    deletedType,galaxyRows,lucusRows});
  // One bounded UPDATE per scalar shape, rather than one round-trip per row.
  // A concurrent change to any expected UID reference fails the row receipt.
  const {batches,singles}=planUidScalarRepairBatches(plan.galaxyUpdates,uid);
  for(const batch of batches){
    const result=await buildUidScalarRepairQuery(db,galaxy,batch,uid,serialize)
      .executeTakeFirst();
    if(Number(result?.numUpdatedRows||0)!==batch.uids.length)failed();
  }
  const native=[],portable=[];
  for(const item of singles){
    if(engine==='postgres'&&nativeArrayRepair(item,uid))native.push(item);
    else portable.push(item);
  }
  // Native PostgreSQL text[] operation; other engines retain the same JS
  // resulting value through Kysely's portable CASE and JSON serialization.
  for(const batch of planUidRepairStatementBatches(native))
    await checkRepairBatch(buildUidNativeArrayRepairQuery(
      db,galaxy,batch,uid,serialize),batch.length);
  for(const batch of planUidRepairStatementBatches(portable))
    await checkRepairBatch(buildUidCaseRepairQuery(db,galaxy,batch,serialize),
      batch.length);
  // Trace endpoint pairs and derived Lucus.num are validated before the
  // UPDATE. Every CASE arm must also match that row's original attr (CAS).
  for(const batch of planUidRepairStatementBatches(plan.lucusUpdates))
    await checkRepairBatch(buildUidCaseRepairQuery(db,lucus,batch,serialize),
      batch.length);
  return {affected:plan.affected,handled:true};
}
