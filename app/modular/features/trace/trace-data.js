'use client';

import {dbPublicClient,dbAuthClient,dbAuthRelation} from '../../../loc/db-client.mjs';
import {findAnchorWriteMatches,organizeAnchorCandidates} from './trace-organizer.mjs';
import {fromAnchorRow,allocateAnchorUid,isUnifiedAnchorScope} from '../../../loc/unified-anchor-compat.mjs';
import {SCOPE_ROUTE_INDEX} from '../../scope-route-index.js';
import {selectScopeGroupMemberIds,selectScopeConfig} from '../../../loc/scope-data';
import {scopeFeatureEnabled} from '../../../loc/scope-config-fields.mjs';
import {mapBounded} from '../../../loc/bounded-parallel.mjs';

const TRACE_SOURCE_SCOPES=Object.freeze(SCOPE_ROUTE_INDEX.map(row=>row.scope_id).filter(id=>id!=='loc'));
async function groupTraceSources(){
  const members=await selectScopeGroupMemberIds('loc','trace');
  const candidates=TRACE_SOURCE_SCOPES.filter(id=>members.has(id));
  // Each contributor must explicitly publish its Scope trace flag.
  // Config requests are already shared across public feature readers.
  // Keep multi-Scope public Config reads below the shared SQL Gateway QoS ceiling.
  const allowed=await mapBounded(candidates,3,async id=>{
    const config=await selectScopeConfig(id);
    return config&&scopeFeatureEnabled(config,'trace')?id:null;
  });
  return allowed.filter(Boolean);
}
export const TRACE_SCOPES=Object.freeze(['loc',...TRACE_SOURCE_SCOPES]);
export const readPublishedTraceSourceScopes=groupTraceSources;
export const traceKey=(scopeId,{includeHidden=false}={})=>['scope-trace',scopeId,...(includeHidden?['manager']:[])];
export const traceMapIndexKey=(scopeId,{nativeOnly=false,includeHidden=false}={})=>['trace-map-index',scopeId,...(nativeOnly?['native']:[]),...(includeHidden?['manager']:[])];
export const traceCurrentKey=(scopeId,route,{nativeOnly=false,includeHidden=false}={})=>
  ['trace-current',scopeId,route.uid,JSON.stringify([route.anchor_list||[],route.route_list||{}]),...(nativeOnly?['native']:[]),...(includeHidden?['manager']:[])];
export const traceAllAnchorsKey=(scopeId,{nativeOnly=false,includeHidden=false}={})=>
  ['trace-all-anchors',scopeId,...(nativeOnly?['native']:[]),...(includeHidden?['manager']:[])];
const VALID_ID=/^(?:[A-Za-z0-9]{4}|[A-Za-z0-9]{8})$/;
const TRACE_TYPES=['space_anchor','path','trace'];
const CORE_COLUMNS='uid,trace_type,title,description,anchor_list,route_list,invisible,times,address';
const ANCHOR_COLUMNS='uid,type,title,description,invisible,attr';
const isUnified=isUnifiedAnchorScope;
const physicalPoint=id=>dbAuthClient.schema('silver').from(id+'_anchor');
const pointVisitTimes=values=>{
  const input=Array.isArray(values)?values:[];
  const timestamps=input.map(value=>Date.parse(String(value||'')));
  if(timestamps.some(stamp=>!Number.isFinite(stamp)))
    throw Error('Point 造訪時間必須是有效的時間戳');
  return [...new Set(timestamps)].sort((a,b)=>a-b).map(value=>new Date(value).toISOString());
};
const pointAttr=({address,longitude,latitude,times=[]})=>{
  const coords=coordinateArray(longitude,latitude),attr={};
  if(coords){attr.longitude=coords[0];attr.latitude=coords[1];}
  if(postalText(address))attr.location=postalText(address);
  if(times.length)attr.times=pointVisitTimes(times);
  return attr;
};
const projectUnified=(row,id)=>{
  const projected=fromAnchorRow({kind:'trace',legacy:'trace'},row);
  const location=row.attr?.location;
  const address=typeof location==='string'?location:'';
  const lng=row.attr?.longitude,lat=row.attr?.latitude;
  const coordinates=lng!=null&&lat!=null&&Number.isFinite(Number(lng))&&Number.isFinite(Number(lat))
    ?[Number(lng),Number(lat)]:null;
  // An array of aliases is never an array of GPS coordinates.
  const paths=Array.isArray(row.attr?.path)?row.attr.path:[];
  const points=Array.isArray(row.attr?.point)?row.attr.point:[];
  // Native Trace uses a flat, ordered point UID array. Every two entries
  // form one segment; the SQL merge contract also replaces flat UID arrays.
  const segments=Array.isArray(points[0])?points:
    row.type==='trace'?points.reduce((list,uid,index)=>{
      if(index%2===0)list.push([uid]);else list[list.length-1].push(uid);
      return list;
    },[]):[];
  return readRow({...projected,attr:row.attr,address:coordinates,
    route_list:{...projected.route_list,routes:paths,segments,postal_address:address}},id);
};
const normalizedInvisible=value=>{if(typeof value==='boolean')return value;if(value===0||value===1)return Boolean(value);throw Error('隱藏設定必須是 0 或 1');};
const idScope=value=>{
  const id=String(value||'').toLowerCase().trim();
  if(!TRACE_SCOPES.includes(id))throw Error('無效的空間 Scope');
  return id;
};
const writableScope=scopeId=>{
  const scope=idScope(scopeId);
  if(scope==='loc')throw Error('LOC 空間聚合尚未重建；請先整理來源 Scope');
  return scope;
};
const relation=id=>'silver.'+writableScope(id)+'_trace';
function checked(result,label){
  if(result.error)throw Error(label+'：'+result.error.message);
  return result.data;
}
const nonempty=(value,label,max=120)=>{
  const result=String(value||'').trim();
  if(!result||result.length>max)throw Error(label+'必填，最多 '+max+' 字');
  return result;
};
const textValue=value=>String(value??'').trim();
const noteValue=value=>typeof value==='string'?value:String(value?.text||'');
const descriptionText=text=>{const message=textValue(text);if(message.length>2000)throw Error('說明文字過長');return message;};
const postalText=value=>{const text=textValue(value);if(text.length>320)throw Error('文字地址過長');return text;};
export const traceRouteData=row=>{
  const value=row?.route_list;
  if(value&&typeof value==='object'&&!Array.isArray(value))
    return {routes:Array.isArray(value.routes)?value.routes:[],segments:Array.isArray(value.segments)?value.segments:[],
      postal_address:String(value.postal_address||'')};
  return {routes:Array.isArray(value)?value:[],
    segments:Array.isArray(row?.anchor_list?.[0])?row.anchor_list:[],postal_address:''};
};
export const validCoordinates=(longitude,latitude)=>
  (longitude==null||String(longitude).trim()==='')&&(latitude==null||String(latitude).trim()==='')
  ||(longitude!=null&&latitude!=null&&String(longitude).trim()!==''&&String(latitude).trim()!==''
    &&Number.isFinite(Number(longitude))&&Number.isFinite(Number(latitude))
    &&Math.abs(Number(longitude))<=180&&Math.abs(Number(latitude))<=90);
export const validRadius=value=>Number.isInteger(Number(value))&&Number(value)>=10&&Number(value)<=20000000;
const coordinateArray=(longitude,latitude)=>{
  if(!validCoordinates(longitude,latitude))throw Error('經緯度需同時輸入有效數值，或同時留空');
  if(longitude==null||String(longitude).trim()==='')return null;
  return [Number(longitude),Number(latitude)];
};
function readRow(row,scope){
  const description=row?.description;
  const relations=traceRouteData(row);
  const coordinates=Array.isArray(row?.address)&&row.address.length===2?row.address:null;
  return {...row,description:noteValue(description),postal_address:relations.postal_address||String(description?.address||''),
    longitude:coordinates?.[0]??null,latitude:coordinates?.[1]??null,
    source_scope:row.scope_id||scope,anchor_list:Array.isArray(row.anchor_list)?row.anchor_list.flat(Infinity):[],route_list:relations};
}
async function readPages(id,{columns=CORE_COLUMNS,filter=null,types=null,limit=null,nativeOnly=false,includeHidden=false}={}){
  // The LOC materialized union was deliberately dropped. Never query it
  // until the owner Scope place data has been reviewed and a new union built.
  if(id==='loc')return [];
  const readClient=includeHidden?dbAuthClient:dbPublicClient;
  if(isUnified(id)){
    const rows=[],size=750,selectedTypes=types|| (filter?[filter==='space_anchor'?'point':filter]:['point','path','trace']);
    for(let offset=0;;offset+=size){
      const result=checked(await readClient.schema('silver').from(id+'_anchor')
        .select(ANCHOR_COLUMNS).in('type',selectedTypes).order('title',{ascending:true})
        .range(offset,offset+Math.min(size,limit===null?size:limit-offset)-1),'空間 Anchor 讀取')||[];
      rows.push(...result.map(row=>projectUnified(row,id)));
      if(result.length<size||limit!==null&&rows.length>=limit)break;
    }
    return rows;
  }
  const union=false,rows=[],size=750;
  for(let offset=0;;offset+=size){
    // Public lists use anonymous RLS; only includeHidden manager reads use LOC Auth.
    let query=readClient.schema('silver').from(id+'_trace')
      .select(columns+(union?',scope_id':'')).order('title',{ascending:true})
      .range(offset,offset+Math.min(size,limit===null?size:limit-offset)-1);
    if(types)query=query.in('trace_type',types);
    else if(filter)query=query.eq('trace_type',filter);
    if(union&&nativeOnly)query=query.eq('scope_id','loc');
    if(union)query=query.order('scope_id',{ascending:true});
    const batch=checked(await query,'空間資料讀取')||[];
    rows.push(...batch.map(row=>readRow(row,id)));
    if(batch.length<size||limit!==null&&rows.length>=limit)break;
  }
  return rows;
}
export async function readTraceData(scopeId,{includeHidden=false}={}){
  const id=idScope(scopeId),rows=await readPages(id,{includeHidden});
  return {anchors:rows.filter(row=>row.trace_type==='space_anchor'),
    maps:rows.filter(row=>row.trace_type==='path'||row.trace_type==='trace')};
}
export async function readTraceMapIndex(scopeId,{nativeOnly=false,includeHidden=false}={}){
  const id=idScope(scopeId);
  if(id==='loc')return mapBounded(await groupTraceSources(),3,
    source=>readTraceMapIndex(source,{includeHidden})).then(groups=>groups.flat());
  return readPages(id,{columns:'uid,trace_type,title,description,anchor_list,route_list,invisible',types:['path','trace'],nativeOnly,includeHidden})
    .then(rows=>rows.filter(row=>row.trace_type==='path'||row.trace_type==='trace'));
}
export const traceMemberUids=record=>[...new Set((record?.anchor_list||[])
  .flat(Infinity).map(uid=>String(uid||'').trim()).filter(uid=>VALID_ID.test(uid)))];
export async function readCurrentTraceAnchors(scopeId,anchorUids=[],{nativeOnly=false,includeHidden=false}={}){
  const id=idScope(scopeId);
  if(id==='loc')return [];
  const ids=[...new Set((anchorUids||[]).flat(Infinity)
    .map(uid=>String(uid||'').trim()).filter(uid=>VALID_ID.test(uid)))];
  if(!ids.length)return [];
  if(ids.length>800)throw Error('地點數量超過上限');
  const readClient=includeHidden?dbAuthClient:dbPublicClient;
  let query=readClient.schema('silver').from(isUnified(id)?id+'_anchor':id+'_trace')
    .select(isUnified(id)?ANCHOR_COLUMNS:CORE_COLUMNS+(id==='loc'?',scope_id':''))
    .eq(isUnified(id)?'type':'trace_type',isUnified(id)?'point':'space_anchor').in('uid',ids).limit(900);
  if(id==='loc'&&nativeOnly)query=query.eq('scope_id','loc');
  const rows=(checked(await query,'空間地點讀取')||[]).map(row=>isUnified(id)?projectUnified(row,id):readRow(row,id));
  const byId=new Map(rows.map(row=>[row.uid,row]));
  return ids.map(uid=>byId.get(uid)).filter(Boolean);
}
export async function readAllTraceAnchors(scopeId,{nativeOnly=false,includeHidden=false}={}){
  const id=idScope(scopeId);
  if(id==='loc'){
    // No LOC materialized Trace table: keep source Scope ownership and RLS intact.
    const sources=await mapBounded(await groupTraceSources(),3,source=>
      readPages(source,{filter:'space_anchor',includeHidden}));
    return sources.flat();
  }
  return readPages(id,{filter:'space_anchor',nativeOnly,includeHidden});
}
export async function readTraceAnchorSuggestions(scopeId,term,limit=8){
  const id=idScope(scopeId),q=textValue(term).slice(0,100);
  if(id==='loc'||!q)return [];
  const data=checked(await dbAuthClient.schema('silver').publicAction('search_scope_trace_place_names',{
    p_scope_id:id,p_term:q,p_limit:Math.max(1,Math.min(Number(limit)||8,100))
  }),'搜尋地點標題')||[];
  if(!data.length)return [];
  const ids=data.map(row=>row.uid).filter(uid=>VALID_ID.test(String(uid)));
  if(!ids.length)return [];
  if(isUnified(id)){
    const allowed=checked(await dbPublicClient.schema('silver').from(id+'_anchor')
      .select(ANCHOR_COLUMNS).eq('type','point').in('uid',ids),'公開地點權限檢查')||[];
    const byUid=new Map(allowed.map(row=>[row.uid,row]));
    return ids.map(uid=>byUid.get(uid)).filter(Boolean).map(row=>projectUnified(row,id));
  }
  const allowed=checked(await dbPublicClient.schema('silver').from(id+'_trace')
    .select('uid').eq('trace_type','space_anchor').in('uid',ids),'公開地點權限檢查')||[];
  const visible=new Set(allowed.map(row=>row.uid));
  return data.filter(row=>visible.has(row.uid)).map(row=>readRow({...row,trace_type:'space_anchor'},id));
}
export async function readTracePopularAnchors(scopeId){
  const id=idScope(scopeId);
  if(id==='loc'){
    const members=await groupTraceSources();
    for(const member of members){
      const result=await readPages(member,{filter:'space_anchor',limit:10});
      if(result.length)return result;
    }
    return [];
  }
  return readPages(id,{filter:'space_anchor',limit:10});
}
// Cross-Scope reference suggestions remain disabled while LOC union is absent.
export async function readTraceAddressReferences(_scopeId,_term,_limit=8){
  return [];
}
export async function inspectTraceAnchorBeforeWrite({scopeId,anchor,excludeUid=''}){
  const id=idScope(scopeId),anchors=await readAllTraceAnchors(id,{nativeOnly:id==='loc'});
  const matches=findAnchorWriteMatches({...anchor,trace_type:'space_anchor',source_scope:id},
    anchors.filter(row=>row.uid!==excludeUid));
  return {reuse:null,matches}; // Never merge spatial identities without explicit approval.
}
export async function addTraceAnchor({scopeId,title,description='',address='',longitude,latitude,times=[],invisible=false}){
  const id=writableScope(scopeId);
  const record={trace_type:'space_anchor',title:nonempty(title,'地點標題'),
    description:descriptionText(description),route_list:{routes:[],segments:[],postal_address:postalText(address)},
    address:coordinateArray(longitude,latitude),invisible:normalizedInvisible(invisible),
    times:Array.isArray(times)?times:[],anchor_list:[]};
  if(isUnified(id)){
    const row={uid:allocateAnchorUid(),type:'point',title:record.title,
      description:record.description,invisible:record.invisible,
      attr:pointAttr({address,longitude,latitude,times:record.times})};
    return checked(await physicalPoint(id).insert(row).select('uid').single(),'新增空間定錨點');
  }
  let query=dbAuthRelation(relation(id)).insert(record).select('uid').single();
  return checked(await query,'新增空間定錨點');
}
export async function updateTraceAnchor({scopeId,uid,title,description='',address='',longitude,latitude,invisible=false}){
  const id=writableScope(scopeId),selected=textValue(uid);
  if(!VALID_ID.test(selected))throw Error('地點 UID 必須是四碼');
  const record={title:nonempty(title,'地點標題'),
    description:descriptionText(description),
    address:coordinateArray(longitude,latitude),invisible:normalizedInvisible(invisible),route_list:{routes:[],segments:[],postal_address:postalText(address)}};
  if(isUnified(id)){
    const before=checked(await physicalPoint(id).select('uid,attr').eq('uid',selected)
      .eq('type','point').maybeSingle(),'讀取空間定錨點');
    if(!before)throw Error('空間定錨點不存在，請重新載入');
    const attr={...(before.attr||{})};
    const coords=coordinateArray(longitude,latitude);
    if(coords){attr.longitude=coords[0];attr.latitude=coords[1];}
    else{delete attr.longitude;delete attr.latitude;}
    const location=postalText(address);
    if(location){
      if(Array.isArray(attr.location))attr.location=[...new Set([...attr.location,location])];
      else attr.location=location;
    }
    return checked(await physicalPoint(id).update({title:record.title,
      description:record.description,invisible:record.invisible,attr})
      .eq('uid',selected).eq('type','point').select('uid').single(),'更新空間定錨點');
  }
  let query=dbAuthRelation(relation(id)).update(record).eq('uid',selected).eq('trace_type','space_anchor');
  if(id==='loc')query=query.eq('scope_id','loc');
  return checked(await query.select('uid').single(),'更新空間定錨點');
}
// Bulk rename preserves every Trace UID, coordinate, timestamp and route reference.
// It changes title only; the caller explicitly selects a reviewed canonical spelling.
export async function renameTraceAnchorTitles({scopeId,uids,title}){
  const id=writableScope(scopeId);
  const ids=[...new Set((uids||[]).map(value=>textValue(value)))];
  if(!ids.length||ids.length>100||ids.some(uid=>!VALID_ID.test(uid)))
    throw Error('快速更新定錨點清單無效');
  if(isUnified(id)){
    const rows=checked(await physicalPoint(id).update({title:nonempty(title,'地點標題')})
      .eq('type','point').in('uid',ids).select('uid'),'快速更新地點名稱')||[];
    if(rows.length!==ids.length)throw Error('部分地點未能更新，請重新載入確認 UID');
    return rows.length;
  }
  const result=checked(await dbAuthRelation(relation(id))
    .update({title:nonempty(title,'地點標題')})
    .eq('trace_type','space_anchor').in('uid',ids)
    .select('uid'),'快速更新地點名稱')||[];
  if(result.length!==ids.length)throw Error('部分地點未能更新，請重新載入確認 UID');
  return result.length;
}
export async function addTraceAnchorsBatch({scopeId,places=[]}){
  const id=writableScope(scopeId);
  if(id==='loc')throw Error('請在作品 Scope 儲存地點');
  if(!Array.isArray(places)||places.length>2000)throw Error('大量匯入範圍無效');
  const existing=await readAllTraceAnchors(id),seen=new Set(existing
    .map(item=>item.title.trim().toLocaleLowerCase()+'|'+JSON.stringify(item.address)));
  const inserts=[];let skipped=0;
  for(const place of places){
    const title=nonempty(place.title,'地點標題');
    const address=coordinateArray(place.longitude,place.latitude);
    const key=title.toLocaleLowerCase()+'|'+JSON.stringify(address);
    if(seen.has(key)){skipped++;continue;}
    seen.add(key);
    inserts.push({trace_type:'space_anchor',title,
      description:descriptionText(place.description||''),
      route_list:{routes:[],segments:[],postal_address:postalText(place.address||'')},
      address,anchor_list:[],times:Array.isArray(place.times)?place.times:[]});
  }
  let count=0;
  if(isUnified(id)){
    for(let offset=0;offset<inserts.length;offset+=80){
      const rows=inserts.slice(offset,offset+80).map(place=>({
        uid:allocateAnchorUid(),type:'point',title:place.title,
        description:place.description,invisible:false,
        attr:pointAttr({address:place.route_list.postal_address,
          longitude:place.address?.[0],latitude:place.address?.[1],times:place.times})
      }));
      count+=(checked(await physicalPoint(id).insert(rows).select('uid'),'批次新增地點')||[]).length;
    }
    const review=organizeAnchorCandidates(await readAllTraceAnchors(id));
    return {count,skipped,consolidated:0,duplicatesInBatch:skipped,reviewCount:review.length,
      reviewPreview:review.slice(0,8),auditError:''};
  }
  for(let offset=0;offset<inserts.length;offset+=80){
    const chunk=inserts.slice(offset,offset+80);
    const inserted=checked(await dbAuthRelation(relation(id)).insert(chunk).select('uid'),'批次新增地點')||[];
    count+=inserted.length;
  }
  const review=organizeAnchorCandidates((await readAllTraceAnchors(id)));
  return {count,skipped,consolidated:0,duplicatesInBatch:skipped,reviewCount:review.length,
    reviewPreview:review.slice(0,8),auditError:''};
}
function validatedConnections({scopeId,type,anchorUids=[],anchors=[],hasRoutes=false}){
  const id=idScope(scopeId),list=Array.isArray(anchorUids)?anchorUids:[];
  if(!['path','trace'].includes(type))throw Error('無效的連線類型');
  const ids=list.flat(Infinity);
  const known=new Set((anchors||[]).filter(row=>row.source_scope===id).map(row=>row.uid));
  if(ids.some(uid=>!VALID_ID.test(String(uid))||!known.has(uid)))throw Error('連線含不存在或跨 Scope 的地點');
  if(type==='path'){
    if(list.length<2||list.length>80||list.some(Array.isArray)||new Set(list).size!==list.length)
      throw Error('路線需依序排列 2～80 個不同地點');
  }else if((!hasRoutes&&list.length<1)||list.length>400||list.some(pair=>
    !Array.isArray(pair)||pair.length!==2||pair[0]===pair[1]||pair.some(Array.isArray)))
    throw Error('痕跡圖需由一組以上的起點／終點配對組成');
  return list;
}
// A Spatial Trace's second level is an explicit list of existing routes, not
// geographic inference. Members are validated in the same writable Scope.
async function validatedRouteList(scopeId,type,routeUids=[]){
  const ids=[...new Set((Array.isArray(routeUids)?routeUids:[]).map(textValue))];
  if(ids.length>80||ids.some(uid=>!VALID_ID.test(uid)))throw Error('路線圖關聯必須是本 Scope 的四碼 UID');
  if(type!=='trace'){
    if(ids.length)throw Error('只有空間痕跡圖可包含路線圖');
    return [];
  }
  if(!ids.length)return [];
  const rows=checked(await (isUnified(scopeId)
    ?dbAuthClient.schema('silver').from(scopeId+'_anchor').select('uid')
      .eq('type','path').in('uid',ids).limit(81)
    :dbAuthRelation(relation(scopeId)).select('uid')
      .eq('trace_type','path').in('uid',ids).limit(81)),'確認下層路線圖')||[];
  if(rows.length!==ids.length)throw Error('包含不存在或跨 Scope 的路線圖');
  return ids;
}
const validUid=value=>VALID_ID.test(textValue(value));
export async function addTraceMap({scopeId,title,description='',type='path',anchorUids=[],anchors=[],routeUids=[],invisible=false}){
  const id=writableScope(scopeId),route_list=await validatedRouteList(id,type,routeUids);
  const anchor_list=validatedConnections({scopeId:id,type,anchorUids,anchors,hasRoutes:route_list.length>0});
  if(isUnified(id)){
    return checked(await dbAuthClient.schema('silver').from(id+'_anchor').insert({
      uid:allocateAnchorUid(),type,title:nonempty(title,'名稱'),
      description:descriptionText(description),invisible:normalizedInvisible(invisible),
      attr:type==='path'?{point:anchor_list}:{point:anchor_list.flat(),path:route_list}
    }).select('uid').single(),'儲存路線或痕跡圖');
  }
  return checked(await dbAuthRelation(relation(id)).insert({
    trace_type:type,title:nonempty(title,'名稱'),description:descriptionText(description),
    anchor_list:type==='path'?anchor_list:[...new Set(anchor_list.flat())],
    route_list:{routes:route_list,segments:type==='trace'?anchor_list:[]},invisible:normalizedInvisible(invisible)
  }).select('uid').single(),'儲存路線或痕跡圖');
}
export async function updateTraceMap({scopeId,uid,title,description='',type='path',anchorUids=[],anchors=[],routeUids=[],invisible=false}){
  const id=writableScope(scopeId),key=textValue(uid);
  if(!validUid(key))throw Error('無效 UID');
  const route_list=await validatedRouteList(id,type,routeUids);
  const anchor_list=validatedConnections({scopeId:id,type,anchorUids,anchors,hasRoutes:route_list.length>0});
  if(isUnified(id)){
    const current=checked(await dbAuthClient.schema('silver').from(id+'_anchor')
      .select('uid,attr').eq('uid',key).eq('type',type).maybeSingle(),'讀取路線／痕跡圖');
    if(!current)throw Error('指定的路線／痕跡圖不存在');
    const attr={...(current.attr||{}),point:type==='trace'?anchor_list.flat():anchor_list};
    if(type==='trace')attr.path=route_list;
    return checked(await dbAuthClient.schema('silver').from(id+'_anchor')
      .update({title:nonempty(title,'名稱'),description:descriptionText(description),
        invisible:normalizedInvisible(invisible),attr})
      .eq('uid',key).eq('type',type).select('uid').single(),'更新路線或痕跡圖');
  }
  let query=dbAuthRelation(relation(id)).update({
    title:nonempty(title,'名稱'),description:descriptionText(description),
    anchor_list:type==='path'?anchor_list:[...new Set(anchor_list.flat())],
    route_list:{routes:route_list,segments:type==='trace'?anchor_list:[]},
    invisible:normalizedInvisible(invisible)
  }).eq('uid',key).eq('trace_type',type);
  if(id==='loc')query=query.eq('scope_id','loc');
  return checked(await query.select('uid').single(),'更新路線或痕跡圖');
}
export async function updateTraceVisibilityBulk({scopeId,uids=[],invisible=false}){
  const id=writableScope(scopeId),ids=[...new Set(uids.map(textValue))];
  if(!ids.length||ids.length>200||ids.some(uid=>!VALID_ID.test(uid)))throw Error('請選擇 1 至 200 筆有效項目');
  if(isUnified(id)){
    const rows=checked(await physicalPoint(id).update({invisible:normalizedInvisible(invisible)})
      .eq('type','point').in('uid',ids).select('uid'),'大量設定空間隱藏')||[];
    if(rows.length!==ids.length)throw Error('部分地點權限未更新，請重新讀取');
    return rows.length;
  }
  const rows=checked(await dbAuthRelation(relation(id)).update({invisible:normalizedInvisible(invisible)})
    .in('uid',ids).select('uid'),'大量設定空間隱藏')||[];
  if(rows.length!==ids.length)throw Error('部分地點權限未更新，請重新讀取');
  return rows.length;
}
export async function deleteTraceMap({scopeId,uid,type='path'}){
  const id=writableScope(scopeId);
  if(!validUid(uid)||!['path','trace'].includes(type))throw Error('無效的刪除目標');
  if(isUnified(id))return checked(await dbAuthClient.schema('silver').from(id+'_anchor')
    .delete().eq('uid',uid).eq('type',type).select('uid').single(),'刪除路線或痕跡圖');
  let query=dbAuthRelation(relation(id)).delete().eq('uid',uid).eq('trace_type',type);
  if(id==='loc')query=query.eq('scope_id','loc');
  return checked(await query.select('uid').single(),'刪除路線或痕跡圖');
}

/** User-approved merge: one authenticated RPC owns the single database transaction.
 * The RPC must repoint Galaxy.place_id and path/trace attr.point, retain aliases
 * in the primary point's attr.location, and delete source points atomically.
 * No client-side multi-step deletion or fallback to obsolete _trace.
 */
export async function mergeTraceAnchorPoints({scopeId,keepUid,removeUids=[]}){
  const id=writableScope(scopeId),primary=textValue(keepUid);
  if(!isUnified(id))throw Error('此 Scope 尚未提供統一空間合併');
  const sources=[...new Set(removeUids.map(textValue).filter(Boolean))];
  if(!/^[A-Za-z0-9]{8}$/.test(primary)||sources.length<1||sources.length>100||
    sources.includes(primary)||sources.some(uid=>!/^[A-Za-z0-9]{8}$/.test(uid))||
    sources.length!==removeUids.length)
    throw Error('合併清單無效：主要地點及來源 UID 必須各自唯一');
  const data=checked(await dbAuthClient.schema('silver').managedAction('merge_scope_trace_place_names',{
    p_scope_id:id,p_keep_uid:primary,p_remove_uids:sources
  }),'合併空間定錨');
  const count=typeof data==='number'?data:data?.merged_count;
  if(count!==sources.length)throw Error('合併結果未確認，請重新讀取後核對');
  return count;
}
