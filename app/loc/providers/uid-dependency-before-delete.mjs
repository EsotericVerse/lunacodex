import {planUidDependencyRepair} from '../uid-dependency-immer.mjs';
import {PERSISTED_ANCHOR_TYPES} from '../../../zenstack/anchor-hierarchy.mjs';

const UID=/^[A-Za-z0-9]{8}$/;
const SCOPED=/^([a-z][a-z0-9]{0,14})_(galaxy|anchor)$/;
const SOURCE_PARENT={from:['domain'],domain:['galaxy'],galaxy:['universe']};
const PARENTS={date:['period'],period:['era'],point:['path','trace'],
  path:['trace'],item:['group'],group:['class'],class:['category'],
  pattern:['item'],...SOURCE_PARENT};
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
  const parentTypes=kind==='galaxy'?['pattern']:(PARENTS[deletedType]||[]);
  let galaxyRows=[],anchorRows=[];
  // Two narrow, independent projections at most. No JOIN or body reads.
  if(galaxy&&galaxyColumns.length){
    let query=db.selectFrom(galaxy).select(galaxyColumns);
    if(deletedType==='point')query=query.where('place_id','=',uid);
    galaxyRows=await query.execute();
  }
  // The Galaxy projection already contains the deleted article's PK.
  // Never change other references when the requested article is absent.
  if(kind==='galaxy'&&!galaxyRows.some(row=>row.uid===uid))
    return {affected:0,handled:true};
  if(parentTypes.length){
    anchorRows=await db.selectFrom(anchor).select(['uid','type','attr'])
      .where('type','in',parentTypes).execute();
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
