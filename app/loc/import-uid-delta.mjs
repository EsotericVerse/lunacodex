// Import-time, UID-only difference planning. Keep large Galaxy content and
// ZModel schemas outside Immer drafts; only project 8-character relationships.
// Database writes still run through the existing authorized Kysely importer.
import {enablePatches,produceWithPatches} from 'immer';

enablePatches();
const UID=/^[A-Za-z0-9]{8}$/;
const ARTICLE_SCALARS=Object.freeze(['source_id','ref_id']);

function checkedUid(value){
  // UID comparison is exact: even one whitespace character is different.
  const id=typeof value==='string'?value:'';
  if(!UID.test(id))throw new Error('匯入關聯包含無效的八碼 UID：'+id);
  return id;
}
function changedFields(next,patches){
  const fields=new Set(patches.map(patch=>patch.path[0]));
  return Object.fromEntries([...fields].map(field=>[field,next[field]]));
}

// Resolve only verified in-file aliases and saved Galaxy primary keys.
// Cycles and conflicting aliases are rejected; never guess identity from
// a title, date, content, URL or Anchor hierarchy.
export function createImportUidResolver(aliases=new Map(),existingByUid=new Map()){
  if(!(aliases instanceof Map)||!(existingByUid instanceof Map))
    throw new TypeError('匯入 UID 對應表必須是 Map');
  return value=>{
    const original=checkedUid(value);
    let current=original;
    const visited=new Set();
    while(aliases.has(current)){
      if(visited.has(current))throw new Error('匯入 UID 別名連結形成循環：'+current);
      visited.add(current);
      const next=checkedUid(aliases.get(current));
      if(next===current)break;
      current=next;
    }
    const persisted=existingByUid.get(current);
    return persisted?checkedUid(persisted.uid):current;
  };
}

// Small-chain propagation happens on imported rows before both INSERT and
// UPDATE. Every changed UID field is reported once; unrelated values keep
// their original references and are never copied into an Immer draft.
export function remapImportUidRelations(records=[],{
  aliases=new Map(),existingByUid=new Map()
}={}){
  if(!Array.isArray(records))throw new TypeError('匯入文章不是陣列');
  const resolve=createImportUidResolver(aliases,existingByUid);
  const rows=[],changesByUid=new Map();
  for(const row of records){
    const key=checkedUid(row?.uid);
    const before={
      source_id:row.source_id??null,
      ref_id:row.ref_id??null,
      target_id:Array.isArray(row.target_id)?[...row.target_id]:null
    };
    const [next,patches]=produceWithPatches(before,draft=>{
      for(const field of ARTICLE_SCALARS){
        const value=draft[field];
        if(typeof value==='string'&&UID.test(value)){
          const mapped=resolve(value);
          if(mapped!==value)draft[field]=mapped;
        }
      }
      if(Array.isArray(draft.target_id)){
        let remapped=false;
        for(let i=0;i<draft.target_id.length;i++){
          const value=draft.target_id[i];
          if(typeof value!=='string'||!UID.test(value))continue;
          const mapped=resolve(value);
          if(mapped!==value){draft.target_id[i]=mapped;remapped=true}
        }
        // Two import aliases can refer to the same persisted article.
        // Preserve link order, remove only post-remap duplicate UIDs.
        if(remapped){
          const seen=new Set();
          const unique=draft.target_id.filter(value=>{
            if(seen.has(value))return false;
            seen.add(value);return true;
          });
          if(unique.length!==draft.target_id.length)draft.target_id=unique;
        }
      }
    });
    if(!patches.length){rows.push(row);continue}
    const changes=changedFields(next,patches);
    rows.push({...row,...changes});
    changesByUid.set(key,{changes,patches});
  }
  return {rows,changesByUid};
}

// Reimport policy: fill previously empty UID references; do not overwrite
// curated nonempty links. Spatial Point UID is already resolved by its own
// import index, so changing it is an exact-PK operation, not a name match.
export function planExistingImportUidUpdate(existing,incoming,{
  placeUid=null,resolveSavedUid=id=>id
}={}){
  if(!existing||!incoming)throw new TypeError('匯入 UID 更新缺少資料');
  const before={
    source_id:existing.source_id??null,
    ref_id:existing.ref_id??null,
    target_id:Array.isArray(existing.target_id)?[...existing.target_id]:[],
    place_id:existing.place_id??null
  };
  const [next,patches]=produceWithPatches(before,draft=>{
    for(const field of ARTICLE_SCALARS){
      const stored=draft[field]??'';
      // Only aliases already resolved to a verified saved PK may rewrite
      // nonempty persisted references. Other curated links are preserved.
      if(stored&&UID.test(stored)){
        const corrected=checkedUid(resolveSavedUid(stored));
        if(corrected!==stored)draft[field]=corrected;
      }else if(!stored&&incoming[field]){
        draft[field]=checkedUid(incoming[field]);
      }
    }
    if(draft.target_id.length){
      const corrected=draft.target_id.map(value=>
        UID.test(String(value))?checkedUid(resolveSavedUid(value)):value);
      if(corrected.some((value,i)=>value!==draft.target_id[i]))
        draft.target_id=[...new Set(corrected)];
    }else if(Array.isArray(incoming.target_id)&&incoming.target_id.length)
      draft.target_id=[...new Set(incoming.target_id.map(checkedUid))];
    if(placeUid){
      const id=checkedUid(placeUid);
      if(draft.place_id!==id)draft.place_id=id;
    }
  });
  return {changes:changedFields(next,patches),patches};
}

// A Point already selected by the import UID index only needs a tiny
// single-column patch. Do not re-run the entire article link planner after
// its source/ref/target changes have already been computed once.
export function planImportPointUidLink(previousUid,nextUid){
  if(!nextUid)return {changes:{},patches:[]};
  const id=checkedUid(nextUid);
  const [next,patches]=produceWithPatches({place_id:previousUid??null},draft=>{
    if(draft.place_id!==id)draft.place_id=id;
  });
  return {changes:changedFields(next,patches),patches};
}

// MediaAnchor UID is a separate namespace. This is the only operation which
// writes media_link: append verified attached IDs to this one saved Galaxy
// article, no global Anchor scan, no changes when the links already exist.
export function planImportMediaUidLinks(prior=[],additions=[]){
  if(!Array.isArray(prior))throw new TypeError('媒體 UID 清單不是陣列');
  const known=new Set(prior.map(checkedUid));
  const before={media_link:[...prior]};
  const [next,patches]=produceWithPatches(before,draft=>{
    for(const raw of additions){
      const id=checkedUid(raw);
      if(known.has(id))continue;
      known.add(id);
      draft.media_link.push(id);
    }
  });
  return {changes:changedFields(next,patches),patches};
}
