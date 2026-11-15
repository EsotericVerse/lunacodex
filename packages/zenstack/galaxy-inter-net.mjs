// Galaxy Inter-Net: one already-authorized Galaxy row -> typed edge inventory.
// Edges describe stored references, not FK existence or access permission.
// This module does NO SQL, network requests, joins, caches or recursive fetch.
// A consumer explicitly opens one branch; unresolved UID edges stay unresolved.
import {composeGalaxyRead} from './galaxy-read-models.mjs';
const UID=/^[A-Za-z0-9]{8}$/;
const GROUPS=Object.freeze(['relation','media','space','time','source']);
const asUid=v=>UID.test(String(v??'').trim())?String(v).trim():'';
const dateOf=v=>{
  if(v instanceof Date)return Number.isNaN(v.valueOf())?'':v.toISOString().slice(0,10);
  const s=String(v??'').slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:'';
};
const add=(array,seen,edge)=>{
  const key=edge.field+'\u0000'+edge.value;
  if(seen.has(key))return;
  seen.add(key);array.push(Object.freeze(edge));
};
export function galaxyInterNetEdges(row={}, {media=[],place=null,relatedTitles={},federated=false}={}){
  const shape=composeGalaxyRead('GalaxyUidRead',row);
  const origin=asUid(shape.uid);
  if(!origin)throw new Error('Galaxy Inter-Net requires a real Galaxy UID');
  const relation=shape.relation||{};
  const anchor=shape.anchor||{};
  const output={relation:[],media:[],space:[],time:[],source:[]};
  const seen=new Set();
  const put=(group,field,value,{kind='galaxy',label='',resolved=null}={})=>{
    if(!GROUPS.includes(group))throw Error('Unknown Inter-Net branch');
    if(kind==='galaxy'||kind==='media'||kind==='point'){
      value=asUid(value);
      if(!value||value===origin)return;
    }else if(kind==='date')value=dateOf(value);
    else value=String(value??'').trim();
    if(!value)return;
    add(output[group],seen,{fromUid:origin,field,value,kind,
      label:String(label||'').trim(),resolved});
  };
  put('relation','source_id',relation.source_id,{label:relatedTitles?.[relation.source_id]||''});
  put('relation','ref_id',relation.ref_id,{label:relatedTitles?.[relation.ref_id]||''});
  for(const target of Array.isArray(relation.target_id)?relation.target_id:[])
    put('relation','target_id',target,{label:relatedTitles?.[target]||''});
  const mediaByUid=new Map((Array.isArray(media)?media:[])
    .filter(item=>asUid(item?.uid)).map(item=>[String(item.uid),item]));
  for(const uid of !federated&&Array.isArray(anchor.media_link)?anchor.media_link:[]){
    const entry=mediaByUid.get(String(uid));
    put('media','media_link',uid,{kind:'media',
      label:entry?.title||entry?.type||'',resolved:entry?true:null});
  }
  if(!federated)put('space','place_id',anchor.place_id,{kind:'point',
    label:place?.uid===anchor.place_id?place?.title||place?.location||'':'',
    resolved:place?.uid===anchor.place_id?true:null});
  // Free text coordinates/location and literal source labels are not UID links.
  if(!federated)put('space','location',anchor.location,{kind:'literal'});
  if(!federated)put('time','date',anchor.date,{kind:'date'});
  put('source','site',anchor.site,{kind:'literal'});
  return Object.freeze({uid:origin,branches:Object.freeze(Object.fromEntries(
    GROUPS.map(group=>[group,Object.freeze(output[group])])
  ))});
}
