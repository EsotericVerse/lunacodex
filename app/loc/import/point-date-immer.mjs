// Import-only Point / Date planning for the unified <scope>_anchor table.
// Simple INSERT and title-backfill values are constructed in JS; the
// authorized Kysely caller still owns ZModel validation, SQL and CAS.
const UID=/^[A-Za-z0-9]{8}$/;
const DAY=/^\d{4}-\d{2}-\d{2}$/;

function checkedUid(uid){
  if(typeof uid!=='string'||!UID.test(uid))
    throw Error('匯入 Point／Date 包含無效 UID：'+String(uid));
  return uid;
}
// New Point / Date INSERTs have no previous row to diff. Construct the
// typed envelope directly; the existing ZModel-derived Zod writer still
// validates the resulting physical row and enforces the SQL contract.
export function planImportPointCreate({uid,title,description,coordinates=null,createtime=null}={}){
  checkedUid(uid);
  // An INSERT has no persisted previous value: construct its small ZModel
  // envelope directly, without creating and discarding an Immer draft.
  const row={uid,type:'point',title,description,attr:{},invisible:false};
  if(coordinates!==null){
    if(!Array.isArray(coordinates)||coordinates.length!==2||
        coordinates.some(value=>typeof value!=='number'||!Number.isFinite(value)))
      throw Error('Point 匯入座標資料無效');
    row.attr.longitude=coordinates[0];
    row.attr.latitude=coordinates[1];
  }
  if(createtime)row.createtime=createtime;
  return {row,patches:[]};
}

export function planImportDateCreate({uid,date,title,description,createtime=null}={}){
  checkedUid(uid);
  if(typeof date!=='string'||!DAY.test(date))
    throw Error('Date Anchor 日期識別無效');
  const row={uid,type:'date',attr:{date},invisible:false,title,description};
  if(createtime)row.createtime=createtime;
  return {row,patches:[]};
}

// Only the legacy date-title backfill is mutable on a reimport. The Date
// identity (attr.date) and UID remain fixed. New Date INSERTs are validated
// through the existing ZModel-generated Zod and do not need a delta.
export function planImportDateTitleDelta(existing,entry,day){
  checkedUid(existing?.uid);
  if(typeof day!=='string'||!DAY.test(day))
    throw Error('Date Anchor 日期識別無效');
  if(!existing||existing.type&&existing.type!=='date')
    throw Error('Date Anchor 型別無效');
  if((existing.title??null)!==day||String(existing.description||'').trim()||
      !entry||entry.title===day)return {changes:{},patches:[]};
  const changes={},patches=[];
  // Immer skipped no-op assignments, so keep that behavior for nullable
  // legacy dates while avoiding a draft for two scalar fields.
  for(const [field,value] of [['title',entry.title],['description',entry.description]]){
    if((existing[field]??null)===value)continue;
    changes[field]=value;
    patches.push({op:'replace',path:[field],value});
  }
  return {changes,patches};
}
