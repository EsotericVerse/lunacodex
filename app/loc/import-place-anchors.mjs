import {importGeoKey} from './import-geocoordinates.mjs';
import {allocateAnchorUid} from './uid.js';
import {planImportPointVisitDelta} from './import-point-date-immer.mjs';

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
  const timesByUid=new Map(),createtimeByUid=new Map(),attrsByUid=new Map();
  const accept=anchor=>{
    if(anchor?.type!=='point')throw Error('Point Anchor 索引型別不符');
    const name=nameKey(anchor?.title),uid=String(anchor?.uid||'');
    if(!VALID_UID.test(uid))return;
    const coordinates=importGeoKey(anchor?.attr);
    // An exact Point UID can be referenced by many differently named
    // Galaxy.location values. Keep its PK in the index even if its label or
    // coordinates are blank; those fields must not decide PK existence.
    timesByUid.set(uid,Array.isArray(anchor.attr?.times)?anchor.attr.times:[]);
    attrsByUid.set(uid,anchor.attr||{});
    createtimeByUid.set(uid,String(anchor.createtime||'')||null);
    if(!name&&!coordinates)return;
    const saved={uid,coordinates};
    if(name){
      if(!existingByName.has(name))existingByName.set(name,[]);
      existingByName.get(name).push(saved);
    }
    if(coordinates){
      if(!existingByCoordinate.has(coordinates))existingByCoordinate.set(coordinates,[]);
      existingByCoordinate.get(coordinates).push(saved);
    }
  };
  return {accept,existingByCoordinate,existingByName,timesByUid,createtimeByUid,attrsByUid};
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
  scopeId,relation,pageSize=750,allowMissing=false,createMissing=true,scanExistingOnEmpty=false,onProgress,anchorSnapshot=null
}={}){
  const {names,missing}=incomingLocations(records);
  const byCoordinate=new Map(),byName=new Map();
  const unavailable=()=>{
    // Even when every imported article already has place_id, its verified
    // Point PK is still needed to append visit times. Return the shared
    // UID-index state instead of dropping it with the empty name list.
    const indexed=anchorSnapshot?.scopeId===scopeId?anchorSnapshot.place:null;
    return {byCoordinate,byName,created:0,reused:0,conflicts:[],
      skipped:missing+names.size,unmatchedCoordinates:names.size,
      ...(indexed?{timesByUid:indexed.timesByUid,attrsByUid:indexed.attrsByUid,
        createtimeByUid:indexed.createtimeByUid,table:anchorSnapshot.table}:{})};
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
  const {existingByCoordinate,existingByName,timesByUid,createtimeByUid,attrsByUid}=index;
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
        return {uid,type:'point',title:place.title,
        description:JSON.stringify({text:'',address:place.postal||null,
          ...(place.placeUrl?{url:place.placeUrl}:{})}),
        attr:place.coordinates
          ?{longitude:place.address[0],latitude:place.address[1]}:{},
        ...(place.createtime!==null?{createtime:new Date(place.createtime).toISOString()}:{}),
        invisible:false
      };});
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
      timesByUid.set(uid,[]);
      attrsByUid.set(uid,anchor.attr||{});
      createtimeByUid.set(uid,place.createtime===null?null:new Date(place.createtime).toISOString());
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
  return {byCoordinate,byName,created,reused,timesByUid,attrsByUid,createtimeByUid,table,
    skipped:missing+unmatchedCoordinates,unmatchedCoordinates,conflicts};
}
export function importedPlaceId({incoming,existing,byName,byCoordinate}={}){
  if(String(existing?.place_id||'').trim())return null;
  const name=nameKey(recordPlaceName(incoming));
  if(!name)return null;
  const coordinates=importGeoKey(incoming?.__importCoordinates);
  const uid=coordinates?byCoordinate?.get(coordinates):byName?.get(name);
  return VALID_UID.test(String(uid||''))?uid:null;
}

// Point.attr.times stores each distinct original check-in instant for a
// geographic identity; createtime remains its independent provenance timestamp.
// Legacy Trace keeps the same deduplicated timestamp list in its times column.
// Bound each UID's independent write with limited concurrency.
const PLACE_VISIT_WRITE_CONCURRENCY=6;
const PLACE_VISIT_WRITE_TIMEOUT_MS=45000;
export async function recordImportPlaceVisits(visits,{relation,table,timesByUid,attrsByUid,createtimeByUid,onProgress}={}){
  if(!Array.isArray(visits)||!visits.length){
    onProgress?.({phase:'補齊定錨打卡時間',completed:0,total:0});
    return {updated:0,added:0};
  }
  // Point visits are keyed by UID, not the original spelling of location.
  // The same place_id can collect many location aliases and visit times.
  const unified=/^silver\.[a-z][a-z0-9]{0,14}_anchor$/.test(String(table||''));
  if(typeof relation!=='function'||!table)throw Error('定錨打卡時間寫入設定不存在');
  const byUid=new Map();
  for(const visit of visits||[]){
    const uid=String(visit?.uid||'');
    const stamp=Date.parse(String(visit?.time??''));
    if(!VALID_UID.test(uid)||!Number.isFinite(stamp))continue;
    if(!byUid.has(uid))byUid.set(uid,new Set());
    byUid.get(uid).add(stamp);
  }
  if(unified){
    // Every linked Galaxy article contributes its exact source timestamp,
    // even when location strings differ but place_id points to the same UID.
    // No per-article UID list is stored in Point.
    const pending=[];
    for(const [uid,stamps] of byUid){
      // Never send a whole-attr replacement without the original Point state:
      // that would erase saved coordinate and location aliases.
      if(!attrsByUid?.has(uid))
        throw Error('Point 原始 attr 不存在；停止補寫以避免覆蓋地點與座標');
      const original=attrsByUid.get(uid)||{};
      const visits=[...stamps];
      const plan=planImportPointVisitDelta({uid,attr:original,
        createtime:createtimeByUid?.get(uid),visits});
      if(!plan.patches.length)continue;
      pending.push({uid,original,visits});
    }
    const phase='補齊 Point 造訪時間',total=pending.length;
    onProgress?.({phase,completed:0,total});
    let cursor=0,completed=0,updated=0,added=0,firstError=null;
    const progressStep=Math.max(1,Math.ceil(total/50));
    const worker=async()=>{
      while(cursor<total&&!firstError){
        const item=pending[cursor++];
        try{
          const {uid,visits}=item;
          let {original}=item;
          let written=false;
          for(let attempt=0;attempt<3&&!written;attempt++){
            // Replan only after a verified optimistic-CAS conflict, using
            // the latest Point attr. Immer touches times / createtime only.
            const plan=planImportPointVisitDelta({uid,attr:original,
              createtime:createtimeByUid?.get(uid),visits});
            if(!plan.patches.length){written=true;break;}
            const values={};
            if(Object.hasOwn(plan.changes,'times'))
              values.attr={...original,times:plan.changes.times};
            if(Object.hasOwn(plan.changes,'createtime'))
              values.createtime=plan.changes.createtime;
            let request=relation(table).update(values)
              .eq('uid',uid).eq('type','point').eq('attr',original).select('uid');
            if(typeof request.abortSignal==='function'&&
              typeof AbortSignal!=='undefined'&&typeof AbortSignal.timeout==='function')
              request=request.abortSignal(AbortSignal.timeout(PLACE_VISIT_WRITE_TIMEOUT_MS));
            const {data,error}=await request;
            if(error)throw Error(error.message||String(error));
            if(!Array.isArray(data))throw Error('Point 造訪時間更新缺少回傳資料');
            if(data.length){
              updated++;added+=plan.added;written=true;
              if(values.attr){
                timesByUid?.set(uid,plan.changes.times);
                attrsByUid?.set(uid,values.attr);
              }
              if(values.createtime)createtimeByUid?.set(uid,values.createtime);
            }else{
              // Concurrent rename/merge may have changed attr; refetch and
              // re-run Immer against the new snapshot, preserving its aliases.
              const {data:latest,error:readError}=await relation(table)
                .select('uid,attr,createtime').eq('uid',uid).eq('type','point').maybeSingle();
              if(readError)throw Error(readError.message||String(readError));
              if(!latest)throw Error('Point 在寫入期間已被移除');
              original=latest.attr||{};
              createtimeByUid?.set(uid,String(latest.createtime||'')||null);
            }
          }
          if(!written)throw Error('Point 造訪時間並行更新衝突，請重新執行');
          completed++;
          if(completed%progressStep===0||completed===total)
            onProgress?.({phase,completed,total});
        }catch(error){if(!firstError)firstError=error;}
      }
    };
    await Promise.all(Array.from({length:Math.min(PLACE_VISIT_WRITE_CONCURRENCY,total)},()=>worker()));
    if(firstError)throw Error('補齊 Point 造訪時間中斷（已處理 '+completed+'/'+total+
      ' 個定錨）；已完成部分不會回滾，可重新執行。原因：'+
      String(firstError?.message||firstError));
    return {updated,added};
  }
  // Assemble one update per real anchor before writing. Existing timestamps
  // are never removed, and repeated runs skip already persisted instants.
  const pending=[];
  for(const [uid,incoming] of byUid){
    const saved=new Set();
    for(const when of timesByUid?.get(uid)||[]){
      const stamp=Date.parse(String(when||''));
      if(Number.isFinite(stamp))saved.add(stamp);
    }
    const fresh=[...incoming].filter(stamp=>!saved.has(stamp));
    if(!fresh.length)continue;
    const merged=[...new Set([...saved,...fresh])].sort((a,b)=>a-b)
      .map(stamp=>new Date(stamp).toISOString());
    pending.push({uid,merged,added:fresh.length});
  }
  const total=pending.length,phase='補齊定錨打卡時間';
  onProgress?.({phase,completed:0,total});
  if(!total)return {updated:0,added:0};

  let cursor=0,completed=0,updated=0,added=0,firstError=null;
  const progressStep=Math.max(1,Math.ceil(total/50));
  const worker=async()=>{
    while(cursor<total&&!firstError){
      const {uid,merged,added:delta}=pending[cursor++];
      try{
        let request=relation(table).update({times:merged})
          .eq('uid',uid).eq('trace_type','space_anchor');
        // An aborted request is reported as a partial write failure. Re-run
        // after checking status: the next scan reads actual persisted times.
        if(typeof request.abortSignal==='function'&&
          typeof AbortSignal!=='undefined'&&typeof AbortSignal.timeout==='function')
          request=request.abortSignal(AbortSignal.timeout(PLACE_VISIT_WRITE_TIMEOUT_MS));
        const {error}=await request;
        if(error)throw Error(error.message||String(error));
        timesByUid?.set(uid,merged);
        updated++;added+=delta;
        completed++;
        if(completed%progressStep===0||completed===total)
          onProgress?.({phase,completed,total});
      }catch(error){
        if(!firstError)firstError=error;
      }
    }
  };
  await Promise.all(Array.from({length:Math.min(PLACE_VISIT_WRITE_CONCURRENCY,total)},
    ()=>worker()));
  if(firstError)throw Error('補齊打卡時間中斷（已完成 '+completed+'/'+total+
    ' 個定錨）；已完成部分不會回滾，重新執行會先比對去重。原因：'+
    String(firstError?.message||firstError));
  return {updated,added};
}
