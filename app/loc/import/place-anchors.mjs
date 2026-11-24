import {MAX_ROWS} from '../query/query-batch-size.mjs';
import {importGeoKey} from './geocoordinates.mjs';
import {allocateAnchorUid} from '../model/uid.js';
import {planImportPointCreate} from './point-date-immer.mjs';
import {matchPlaceNameCandidates} from '../trace/place-name-candidates.mjs';

// An exact coordinate identifies an existing Trace location even if the
// original place label differs. Without GPS, only unambiguous names are used.
const VALID_UID=/^[A-Za-z0-9]{8}$/;
const normalizedPlaceText=value=>String(value??'').normalize('NFKC')
  .replace(/[\u0000-\u001f]/g,' ').replace(/\s+/g,' ').trim();
const nameKey=value=>normalizedPlaceText(value).toLocaleLowerCase('und');
const safeTitle=value=>{
  // Preserve the Galaxy.location text verbatim. Control characters from old
  // platform exports cannot enter Trace titles, so normalize only the label.
  const title=normalizedPlaceText(value);
  return title&&title.length<=120?title:'';
};
const recordPlaceName=record=>safeTitle(record?.__importPlaceName||record?.location);
const spatialKey=(name,coordinates)=>coordinates?'coordinate:'+coordinates:'name:'+name;
export const importPlaceNameKey=nameKey;

// One reusable in-memory index for a trusted, Scope-filtered Point result set.
// This is a semantic lookup, not a new database PK or a second Anchor table.
export function createImportPlaceIndex(){
  const existingByCoordinate=new Map(),existingByName=new Map();
  const knownPointUids=new Set(),candidatePlaces=[];
  const accept=anchor=>{
    if(anchor?.type!=='point')throw Error('Point Anchor 索引型別不符');
    const name=nameKey(anchor?.title),uid=String(anchor?.uid||'');
    if(!VALID_UID.test(uid))return;
    const coordinates=importGeoKey(anchor?.attr);
    // A place_id is authoritative even without a location label or GPS.
    // No time-list data is read or stored in the Point index.
    knownPointUids.add(uid);
    if(!name&&!coordinates)return;
    const saved={uid,coordinates};
    // Names and aliases are review evidence only. The authoritative exact
    // coordinate/name indexes below are never widened by substring matches.
    const location=anchor?.attr?.location;
    const aliases=Array.isArray(location)?location:
      typeof location==='string'?[location]:[];
    candidatePlaces.push({uid,title:String(anchor.title||''),aliases});
    if(name){
      if(!existingByName.has(name))existingByName.set(name,[]);
      existingByName.get(name).push(saved);
    }
    if(coordinates){
      if(!existingByCoordinate.has(coordinates))existingByCoordinate.set(coordinates,[]);
      existingByCoordinate.get(coordinates).push(saved);
    }
  };
  return {accept,existingByCoordinate,existingByName,knownPointUids,candidatePlaces};
}

function incomingLocations(records){
  const names=new Map();let missing=0;
  for(const record of records||[]){
    const title=recordPlaceName(record);
    const name=nameKey(title);
    if(!name){missing++;continue;}
    const coordinates=importGeoKey(record?.__importCoordinates);
    const key=spatialKey(name,coordinates);
    const postal=String(record?.__importPlaceAddress??'').trim().slice(0,320);
    const rawUrl=String(record?.__importPlaceUrl||record?.placeUrl||'').trim();
    let placeUrl=null;
    try{const uri=new URL(rawUrl);if(['https:','http:'].includes(uri.protocol))placeUrl=uri.href;}
    catch{}
    const previous=names.get(key);
    // One place may be referenced by many articles. The first actual source
    // article instant is a stable creation reference, not a cultural date.
    const parsed=Date.parse(String(record?.createtime||''));
    const created=Number.isFinite(parsed)?parsed:null;
    if(!previous)names.set(key,{name,title,postal,placeUrl,coordinates,
      createtime:created,address:coordinates?JSON.parse(coordinates):null});
    else if(previous){if(!previous.postal&&postal)previous.postal=postal;
      if(!previous.placeUrl&&placeUrl)previous.placeUrl=placeUrl;
      if(created!==null&&(previous.createtime===null||created<previous.createtime))
        previous.createtime=created;}
  }
  return {names,missing};
}
export async function prepareImportPlaceAnchors(records,{
  scopeId,relation,pageSize=MAX_ROWS,allowMissing=false,createMissing=true,scanExistingOnEmpty=false,onProgress,anchorSnapshot=null
}={}){
  const {names,missing}=incomingLocations(records);
  const byCoordinate=new Map(),byName=new Map();
  const unavailable=()=>{
    // Even when every imported article already has place_id, return the
    // shared UID index so verified links can be retained without a name scan.
    const indexed=anchorSnapshot?.scopeId===scopeId?anchorSnapshot.place:null;
    return {byCoordinate,byName,created:0,reused:0,conflicts:[],nameCandidates:[],
      skipped:missing+names.size,unmatchedCoordinates:names.size,
      ...(indexed?{knownPointUids:indexed.knownPointUids,table:anchorSnapshot.table}:{})};
  };
  if((!names.size&&!scanExistingOnEmpty)||scopeId==='local'||scopeId==='loc'||!scopeId)
    return unavailable();
  if(!/^[a-z][a-z0-9]{0,14}$/.test(scopeId))throw Error('空間定錨 Scope 無效');
  if(typeof relation!=='function')throw Error('空間定錨資料庫不存在');
  const table='silver.'+scopeId+'_anchor';
  if(anchorSnapshot&&
      (anchorSnapshot.scopeId!==scopeId||anchorSnapshot.table!==table||
       typeof anchorSnapshot.place?.accept!=='function'))
    throw Error('空間定錨共用索引 Scope 不符');
  const index=anchorSnapshot?.place||createImportPlaceIndex();
  const {existingByCoordinate,existingByName,knownPointUids}=index;
  if(!anchorSnapshot){
    onProgress?.({phase:'讀取現有空間定錨',completed:0,total:0});
    for(let offset=0;;offset+=pageSize){
      const {data,error}=await relation(table)
        .select('uid,type,title,attr,createtime').eq('type','point')
        .order('title',{ascending:true}).order('uid',{ascending:true})
        .range(offset,offset+pageSize-1);
      if(error){
        if(allowMissing&&!createMissing&&['42P01','PGRST205'].includes(String(error.code||'')))
          return unavailable();
        throw Error('讀取空間定錨失敗：'+(error.message||error));
      }
      for(const anchor of data||[])index.accept(anchor);
      onProgress?.({phase:'讀取現有空間定錨',completed:offset+(data||[]).length,total:0});
      if((data||[]).length<pageSize)break;
    }
  }
  // One compiled multi-name scan for ambiguous name-only imports. A name
  // overlap is reported after import, NOT used to repoint a saved UID or to
  // silently reuse a Point with different or unknown coordinates.
  const nameOnly=[...names.values()].filter(place=>
    !place.coordinates&&!existingByName.has(place.name));
  const suggestions=matchPlaceNameCandidates(
    nameOnly.map(place=>({key:place.name,name:place.title})),index.candidatePlaces);
  const nameCandidates=nameOnly.flatMap(place=>{
    const hits=suggestions.get(place.name)||[];
    return hits.length?[{place:place.title,saved_uids:hits.map(hit=>hit.uid),
      saved_titles:hits.map(hit=>hit.title)}]:[];
  }).slice(0,100);
  let reused=0,created=0;
  const pending=[],ambiguousNames=new Set(),conflicts=[];
  const register=(place,uid)=>{
    if(place.coordinates)byCoordinate.set(place.coordinates,uid);
    if(ambiguousNames.has(place.name))return;
    const prior=byName.get(place.name);
    if(prior&&prior!==uid){byName.delete(place.name);ambiguousNames.add(place.name);}
    else byName.set(place.name,uid);
  };
  // Locate exact known coordinates first. Name-only visits can reuse a single
  // unambiguous named anchor, but never choose between different coordinates.
  const ordered=[...names.values()].sort((a,b)=>Number(Boolean(b.coordinates))-Number(Boolean(a.coordinates)));
  // Avoid scanning every location for each name-only place during large imports.
  const coordinatePeers=new Map();
  for(const place of ordered){
    if(!place.coordinates)continue;
    if(!coordinatePeers.has(place.name))coordinatePeers.set(place.name,[]);
    coordinatePeers.get(place.name).push(place);
  }
  const nameOnlyAliases=[];
  for(const place of ordered){
    const candidates=existingByName.get(place.name)||[];
    const matches=place.coordinates
      ?existingByCoordinate.get(place.coordinates)||[]:candidates;
    const matched=matches.length===1?matches[0]:null;
    // Point coordinates and normalized titles are semantic keys, not PKs.
    // If several UIDs claim the same identity, do not pick the first.
    const conflicting=matches.length>1?matches:
      (matched?.coordinates&&existingByCoordinate.get(matched.coordinates)?.length>1
        ?existingByCoordinate.get(matched.coordinates):[]);
    if(conflicting.length){
      conflicts.push({type:'point',place:place.title,
        coordinates:place.coordinates||null,
        saved_uids:[...new Set(conflicting.map(row=>row.uid))].sort()});
      continue;
    }
    if(matched){register(place,matched.uid);reused++;continue;}
    if(!place.coordinates){
      const peers=coordinatePeers.get(place.name)||[];
      if(!candidates.length&&peers.length===1){
        nameOnlyAliases.push({name:place.name,coordinates:peers[0].coordinates});
        continue;
      }
      if(peers.length>1){
        conflicts.push({type:'point',place:place.title,
          coordinates:null,reason:'multiple incoming coordinates',saved_uids:[]});
        continue;
      }
    }
    if(createMissing)pending.push(place);
  }
  // Point identity is an exact GPS pair (or unambiguous name without GPS).
  // Generate native 8-char UIDs and validate by UID, not response order.
  const assigned=new Set([...existingByName.values(),...existingByCoordinate.values()]
    .flat().map(item=>item.uid));
  onProgress?.({phase:'建立原始座標定錨',completed:0,total:pending.length});
  for(let offset=0;offset<pending.length;offset+=80){
    const chunk=pending.slice(offset,offset+80);
    let rows,data,error;
    for(let attempt=0;attempt<4;attempt++){
      rows=chunk.map(place=>{
        const uid=allocateAnchorUid(assigned);assigned.add(uid);
        return planImportPointCreate({
          uid,title:place.title,
          description:JSON.stringify({text:'',address:place.postal||null,
            ...(place.placeUrl?{url:place.placeUrl}:{})}),
          coordinates:place.coordinates?place.address:null,
          createtime:place.createtime===null?null:new Date(place.createtime).toISOString()
        }).row;});
      ({data,error}=await relation(table).insert(rows).select('uid,type,title,attr'));
      if(error?.code==='23505'&&attempt<3)continue;
      break;
    }
    if(error)throw Error('新增空間定錨失敗：'+(error.message||error));
    if(!Array.isArray(data)||data.length!==rows.length)
      throw Error('新增空間定錨回傳筆數不符；重新執行將沿用已寫入的定錨');
    const expected=new Map(rows.map((row,i)=>[row.uid,chunk[i]]));
    const seen=new Set();
    for(const anchor of data){
      const uid=String(anchor?.uid||''),place=expected.get(uid);
      const key=spatialKey(nameKey(anchor?.title),importGeoKey(anchor?.attr));
      if(!place||seen.has(uid)||anchor?.type!=='point'||
          key!==spatialKey(place.name,place.coordinates)||!VALID_UID.test(uid))
        throw Error('新增空間定錨名稱、座標或 UID 不符；重新執行將核對已寫入的定錨');
      seen.add(uid);
      register(place,uid);
      knownPointUids.add(uid);
      created++;
    }
    if(seen.size!==chunk.length)throw Error('新增空間定錨回傳缺少部分座標');
    onProgress?.({phase:'建立原始座標定錨',completed:offset+chunk.length,total:pending.length});
  }
  for(const alias of nameOnlyAliases){
    const uid=byCoordinate.get(alias.coordinates);
    if(uid){register(alias,uid);reused++;}
  }
  const unmatchedCoordinates=names.size-reused-created;
  return {byCoordinate,byName,created,reused,knownPointUids,table,
    skipped:missing+unmatchedCoordinates,unmatchedCoordinates,conflicts,nameCandidates};
}
export function importedPlaceId({incoming,existing,byName,byCoordinate}={}){
  if(String(existing?.place_id||'').trim())return null;
  const name=nameKey(recordPlaceName(incoming));
  if(!name)return null;
  const coordinates=importGeoKey(incoming?.__importCoordinates);
  const uid=coordinates?byCoordinate?.get(coordinates):byName?.get(name);
  return VALID_UID.test(String(uid||''))?uid:null;
}
