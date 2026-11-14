import {produce} from 'immer';
import {ANCHOR_TYPE_GROUPS,PERSISTED_ANCHOR_TYPES} from '../../zenstack/anchor-hierarchy.mjs';
import {SCOPE_PATTERN_POSTING_KEY} from './keyword-anchor-index.mjs';

// An exact UID is an identity; location, date and site are source values,
// never replacement UIDs. Do not infer identities from titles or dates.
const UID=/^[A-Za-z0-9]{8}$/;
const MEDIA_TYPES=new Set(ANCHOR_TYPE_GROUPS.media);
const PARENT_LINKS=Object.freeze({
  date:Object.freeze({period:'uid'}),
  period:Object.freeze({era:'period'}),
  point:Object.freeze({path:'point',trace:'point'}),
  path:Object.freeze({trace:'path'}),
  from:Object.freeze({domain:'uid'}),
  domain:Object.freeze({galaxy:'uid'}),
  galaxy:Object.freeze({universe:'uid'}),
  item:Object.freeze({group:'uid'}),
  group:Object.freeze({class:'uid'}),
  class:Object.freeze({category:'uid'}),
  pattern:Object.freeze({item:'uid'})
});

const hasUid=(list,uid)=>Array.isArray(list)&&list.includes(uid);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function uidOf(value){
  if(typeof value!=='string'||!UID.test(value))
    throw new TypeError('UID must be eight case-sensitive alphanumeric characters');
  return value;
}
function attrOf(row){
  const attr=typeof row?.attr==='string'?JSON.parse(row.attr):row?.attr;
  if(!object(attr))throw new TypeError('Invalid Anchor attr');
  return attr;
}
function withoutUid(list,uid){
  if(!Array.isArray(list)||list.some(item=>typeof item!=='string'||!UID.test(item)))
    throw new TypeError('Invalid UID list');
  return list.filter(item=>item!==uid);
}
// Trace.point is a flat sequence of endpoint PAIRS, not a path list.
// Dropping one UID must remove its entire segment instead of rewiring
// the two neighbouring unrelated endpoints into a new segment.
function withoutTraceSegment(list,uid){
  if(!Array.isArray(list)||list.length%2!==0||
      list.some(value=>typeof value!=='string'||!UID.test(value)))
    throw new TypeError('Invalid Trace point pair list');
  const next=[];
  for(let i=0;i<list.length;i+=2){
    const pair=list.slice(i,i+2);
    if(!pair.includes(uid))next.push(...pair);
  }
  return next;
}
function mark(map,uid){
  if(map.has(uid))throw new TypeError('Duplicate candidate UID');
  map.add(uid);
}

/**
 * Pure, small-scope dependency reconciliation before a DELETE.
 * The caller provides only the already-authorized projection for one Scope.
 * No SQL, RPC, model traversal, extra table or inferred article matching.
 * Each update carries the dependent record's PK and old values so the writer
 * can reject concurrent modification rather than silently overwriting it.
 */
export function planUidDependencyRepair({deletedUid,deletedTable,deletedType='',galaxyRows=[],anchorRows=[]}={}){
  const uid=uidOf(deletedUid);
  if(!['galaxy','anchor'].includes(deletedTable))throw new TypeError('Invalid deleted table');
  if(!Array.isArray(galaxyRows)||!Array.isArray(anchorRows))
    throw new TypeError('Invalid dependency projection');
  if(deletedTable==='anchor'&&!PERSISTED_ANCHOR_TYPES.includes(deletedType))
    throw new TypeError('Unknown Anchor type');
  const isGalaxy=deletedTable==='galaxy';
  const media=!isGalaxy&&MEDIA_TYPES.has(deletedType);
  const point=!isGalaxy&&deletedType==='point';
  const parentFields=isGalaxy?{}:PARENT_LINKS[deletedType]||{};
  const galaxyUpdates=[],anchorUpdates=[],galaxySeen=new Set(),anchorSeen=new Set();
  for(const row of galaxyRows){
    const id=uidOf(row?.uid);
    mark(galaxySeen,id);
    if(isGalaxy&&id===uid)continue;
    const next=produce(row,draft=>{
      if(isGalaxy){
        if(draft.source_id===uid)draft.source_id=null;
        if(draft.ref_id===uid)draft.ref_id=null;
        if(hasUid(draft.target_id,uid))draft.target_id=withoutUid(draft.target_id,uid);
      }else if(media&&hasUid(draft.media_link,uid)){
        draft.media_link=withoutUid(draft.media_link,uid);
      }else if(point&&draft.place_id===uid){
        draft.place_id=null;
      }
    });
    if(next===row)continue;
    const values={},expected={};
    for(const key of ['source_id','target_id','ref_id','media_link','place_id']){
      if(next[key]!==row[key]){
        values[key]=next[key];
        expected[key]=row[key]??null;
      }
    }
    if(Object.keys(values).length)galaxyUpdates.push({uid:id,values,expected});
  }
  for(const row of anchorRows){
    const id=uidOf(row?.uid);
    mark(anchorSeen,id);
    if(!isGalaxy&&id===uid)continue;
    const original=attrOf(row);
    if(isGalaxy){
      if(row.type!=='pattern'||!hasUid(original[SCOPE_PATTERN_POSTING_KEY],uid))continue;
      const next=produce(original,draft=>{
        draft[SCOPE_PATTERN_POSTING_KEY]=withoutUid(draft[SCOPE_PATTERN_POSTING_KEY],uid);
      });
      anchorUpdates.push({uid:id,type:'pattern',
        values:{attr:next,num:BigInt(next[SCOPE_PATTERN_POSTING_KEY].length)},
        expected:{attr:original}});
      continue;
    }
    const field=parentFields[String(row.type||'')];
    if(!field||!hasUid(original[field],uid))continue;
    const next=produce(original,draft=>{
      draft[field]=row.type==='trace'&&field==='point'
        ?withoutTraceSegment(draft[field],uid):withoutUid(draft[field],uid);
    });
    anchorUpdates.push({uid:id,type:row.type,values:{attr:next},expected:{attr:original}});
  }
  return {deletedUid:uid,deletedTable,deletedType,galaxyUpdates,anchorUpdates,
    affected:galaxyUpdates.length+anchorUpdates.length};
}
