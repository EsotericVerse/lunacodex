// Import-only Point / Date delta planning. These are the two ZModel Anchor
// discriminators already represented by the unified <scope>_anchor table.
// Immer drafts small mutable fields, not the complete Anchor attr, article
// body, or Scope-wide model. The authorized Kysely caller owns SQL and CAS.
import {enablePatches,produceWithPatches} from 'immer';

enablePatches();
const UID=/^[A-Za-z0-9]{8}$/;
const DAY=/^\d{4}-\d{2}-\d{2}$/;

function checkedUid(uid){
  if(typeof uid!=='string'||!UID.test(uid))
    throw Error('匯入 Point／Date 包含無效 UID：'+String(uid));
  return uid;
}
function toVisitTimes(values=[]){
  if(!Array.isArray(values))throw TypeError('Point.times 不是陣列');
  return [...new Set(values.map(value=>
    typeof value==='number'?value:Date.parse(String(value??'')))
    .filter(Number.isFinite))].sort((a,b)=>a-b)
    .map(value=>new Date(value).toISOString());
}
function deltaFields(next,patches){
  const fields=new Set(patches.map(patch=>patch.path[0]));
  return Object.fromEntries([...fields].map(field=>[field,next[field]]));
}


// New Point / Date Anchor inserts have no existing row to diff. Immer builds
// the small typed envelope once; the existing ZModel-derived Zod writer still
// validates the resulting physical row and enforces the SQL contract.
export function planImportPointCreate({uid,title,description,coordinates=null,createtime=null}={}){
  checkedUid(uid);
  const [row,patches]=produceWithPatches({
    uid,type:'point',title:null,description:null,attr:{},invisible:false
  },draft=>{
    draft.title=title;
    draft.description=description;
    if(coordinates!==null){
      if(!Array.isArray(coordinates)||coordinates.length!==2||
          coordinates.some(value=>typeof value!=='number'||!Number.isFinite(value)))
        throw Error('Point 匯入座標資料無效');
      draft.attr.longitude=coordinates[0];
      draft.attr.latitude=coordinates[1];
    }
    if(createtime)draft.createtime=createtime;
  });
  return {row,patches};
}

export function planImportDateCreate({uid,date,title,description,createtime=null}={}){
  checkedUid(uid);
  if(typeof date!=='string'||!DAY.test(date))
    throw Error('Date Anchor 日期識別無效');
  const [row,patches]=produceWithPatches({
    uid,type:'date',attr:{date},invisible:false
  },draft=>{
    draft.title=title;
    draft.description=description;
    if(createtime)draft.createtime=createtime;
  });
  return {row,patches};
}

// Point.attr.times and Point.createtime only. Preserve original coordinates,
// aliases and all other attr members in the SQL writer's guarded merge.
export function planImportPointVisitDelta({uid,attr,createtime=null,visits=[]}={}){
  checkedUid(uid);
  if(!attr||typeof attr!=='object'||Array.isArray(attr))
    throw TypeError('Point 原始 attr 無效');
  const current=toVisitTimes(attr.times??[]);
  const arrivals=toVisitTimes(visits);
  const initial={times:current,createtime:createtime||null};
  const [next,patches]=produceWithPatches(initial,draft=>{
    const merged=toVisitTimes([...draft.times,...arrivals]);
    if(merged.length!==draft.times.length||
        merged.some((time,index)=>time!==draft.times[index]))
      draft.times=merged;
    if(!draft.createtime&&merged.length)draft.createtime=merged[0];
  });
  return {uid,changes:deltaFields(next,patches),patches,
    added:next.times.length-current.length};
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
  const initial={title:existing.title??null,description:existing.description??null};
  const [next,patches]=produceWithPatches(initial,draft=>{
    if(draft.title!==day||String(draft.description||'').trim()||
        !entry||entry.title===day)return;
    draft.title=entry.title;
    draft.description=entry.description;
  });
  return {changes:deltaFields(next,patches),patches};
}
