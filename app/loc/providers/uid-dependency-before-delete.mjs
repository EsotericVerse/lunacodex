import {planUidDependencyRepair,UID_DEPENDENT_ANCHOR_FIELDS} from '../uid-dependency-immer.mjs';
import {SCOPE_PATTERN_POSTING_KEY} from '../keyword-anchor-index.mjs';
import {sql} from 'kysely';
import {PERSISTED_ANCHOR_TYPES} from '../../../zenstack/anchor-hierarchy.mjs';

const UID=/^[A-Za-z0-9]{8}$/;
const SCOPED=/^([a-z][a-z0-9]{0,14})_(galaxy|anchor)$/;
const MEDIA=new Set(['image','video','rune','suno']);

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
function comparisons(query,expected,serialize,table){
  const values=serialize(expected,table);
  for(const [field,value] of Object.entries(values))
    query=value===null?query.where(field,'is',null):query.where(field,'=',value);
  return query;
}

/**
 * Reuse the existing authorized Kysely write connection. No additional
 * transaction, stored function or RPC is created. Read only UID projections
 * (never article bodies); repair precisely changed rows by their own PK.
 */
export async function repairBeforeUidDelete(db,{table,filters,engine='postgres',namespace='silver',
  serialize=(values)=>values}={}){
  const match=SCOPED.exec(String(table||''));
  const globalSource=table==='loc_anchor';
  if(!match&&!globalSource)return {affected:0,handled:false};
  const uid=samePkDeletion(filters);
  if(!uid)failed(); // Never silently bypass the guard for broad deletes.
  const owner=match?.[1]||'loc',kind=match?.[2]||'anchor';
  const anchor=typedTable(globalSource?'loc_anchor':owner+'_anchor',engine,namespace);
  const galaxy=globalSource?null:typedTable(owner+'_galaxy',engine,namespace);
  let deletedType='';
  if(kind==='anchor'){
    const row=await db.selectFrom(anchor).select(['uid','type'])
      .where('uid','=',uid).executeTakeFirst();
    if(!row)return {affected:0,handled:true};
    deletedType=String(row.type||'');
    if(filters.some(f=>f.column==='type'&&f.value!==deletedType))
      return {affected:0,handled:true};
    // LOC Blocks share loc_anchor; they aren't typed source nodes.
    if(globalSource&&!PERSISTED_ANCHOR_TYPES.includes(deletedType))
      return {affected:0,handled:true};
  }
  const galaxyColumns=kind==='galaxy'
    ?['uid','source_id','target_id','ref_id']
    :MEDIA.has(deletedType)?['uid','media_link']
      :deletedType==='point'?['uid','place_id']:[];
  const parentFields=kind==='galaxy'
    ?{pattern:SCOPE_PATTERN_POSTING_KEY}
    :UID_DEPENDENT_ANCHOR_FIELDS[deletedType]||{};
  const parentTypes=Object.keys(parentFields);
  let galaxyRows=[],anchorRows=[];
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
    }else if(MEDIA.has(deletedType)){
      query=query.where(listContains('media_link',uid,engine));
    }
    galaxyRows=await query.execute();
  }
  if(kind==='galaxy'&&!galaxyRows.some(row=>row.uid===uid))
    return {affected:0,handled:true};
  if(parentTypes.length){
    anchorRows=await db.selectFrom(anchor).select(['uid','type','attr'])
      .where(eb=>eb.or(parentTypes.map(type=>eb.and([
        eb('type','=',type),
        listContains('attr',uid,engine,parentFields[type])
      ])))).execute();
  }
  const plan=planUidDependencyRepair({deletedUid:uid,deletedTable:kind,
    deletedType,galaxyRows,anchorRows});
  for(const item of plan.galaxyUpdates){
    let query=db.updateTable(galaxy).set(serialize(item.values,galaxy))
      .where('uid','=',item.uid);
    query=comparisons(query,item.expected,serialize,galaxy);
    const result=await query.executeTakeFirst();
    if(Number(result?.numUpdatedRows||0)!==1)failed();
  }
  for(const item of plan.anchorUpdates){
    let query=db.updateTable(anchor).set(serialize(item.values,anchor))
      .where('uid','=',item.uid).where('type','=',item.type);
    query=comparisons(query,item.expected,serialize,anchor);
    const result=await query.executeTakeFirst();
    if(Number(result?.numUpdatedRows||0)!==1)failed();
  }
  return {affected:plan.affected,handled:true};
}
