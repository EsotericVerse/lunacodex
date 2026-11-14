import {importGeoKey} from './import-geocoordinates.mjs';

// Import identity is source site + normalized creation timestamp.
// Native site_id is optional source metadata, not a matching requirement.
export function comparableImportText(value){
  return String(value??'').normalize('NFKC')
    .replace(/[\p{P}\p{S}\p{Z}\s\u200B-\u200D\uFEFF\u2060]/gu,'')
    .toLocaleLowerCase('und');
}
const importSourceKey=record=>{
  const site=String(record?.site??'').trim().toLocaleLowerCase('und');
  const id=String(record?.site_id??'').trim();
  return site&&id?JSON.stringify([site,id]):null;
};
// An album compares with albums only, an article with articles only.
export const importRowRole=record=>
  String(record?.site_id??'').startsWith('album:')?'album':'article';
const importTimeKey=record=>{
  const site=String(record?.site??'').trim().toLocaleLowerCase('und');
  const date=Date.parse(String(record?.createtime??''));
  return site&&Number.isFinite(date)?
    JSON.stringify([site,new Date(date).toISOString(),importRowRole(record)]):null;
};
// Keep separate source rows even when they share a timestamp; an exact UID
// repeated in the same file is the only safe input-level duplicate.
export function dedupeIncomingImport(records=[]){
  const unique=[],aliases=new Map(),byUid=new Map(),byContentTime=new Map(),byNativeId=new Map();
  const indexByUid=new Map();
  const inheritLocation=(uid,row)=>{
    const index=indexByUid.get(uid);
    if(index===undefined)return;
    const saved=unique[index],changes={};
    // Place identity is atomic: never combine another check-in's name,
    // coordinates, URL, or visit times with the canonical post's place.
    // Date is a post attribute, not a place attribute.
    const namesOf=item=>[item.location,item.__importPlaceName]
      .map(name=>String(name??'').normalize('NFKC').trim().toLocaleLowerCase('und'))
      .filter(Boolean);
    const savedNames=namesOf(saved),incomingNames=namesOf(row);
    const conflictingName=Boolean(savedNames.length&&incomingNames.length&&
      incomingNames.some(name=>!savedNames.includes(name)));
    const savedCoord=importGeoKey(saved.__importCoordinates);
    const incomingCoord=importGeoKey(row.__importCoordinates);
    // Exact GPS identity wins even when social exports rename the place.
    // Different coordinates must never be merged, regardless of the label.
    const samePlace=Boolean(savedCoord&&incomingCoord&&savedCoord===incomingCoord)||
      (!conflictingName&&(!savedCoord||!incomingCoord||savedCoord===incomingCoord));
    if(samePlace){
      for(const field of ['location','__importPlaceName','__importPlaceAddress',
        '__importPlaceUrl','__importCoordinates']){
        if((saved[field]==null||saved[field]==='')&&row[field]!=null&&row[field]!=='')
          changes[field]=row[field];
      }
    }
    if((saved.date==null||saved.date==='')&&row.date!=null&&row.date!=='')
      changes.date=row.date;
    if(samePlace&&row.__importCheckin===true)changes.__importCheckin=true;
    if(samePlace&&Array.isArray(row.__importVisitTimes)&&row.__importVisitTimes.length){
      const prior=Array.isArray(saved.__importVisitTimes)?saved.__importVisitTimes:[];
      const combined=[...new Set([...prior,...row.__importVisitTimes].filter(Boolean))];
      if(combined.length!==prior.length)changes.__importVisitTimes=combined;
    }
    if(Object.keys(changes).length)unique[index]={...saved,...changes};
  };
  let duplicates=0;
  for(const row of records){
    const uid=String(row?.uid||'').trim();
    if(!uid)throw Error('匯入文章缺少 UID');
    const prior=byUid.get(uid);
    if(prior){
      if(String(prior.site||'').trim().toLocaleLowerCase('und')!==
          String(row.site||'').trim().toLocaleLowerCase('und')||
          importTimeKey(prior)!==importTimeKey(row)||
          String(prior.content??'')!==String(row.content??'')||
          String(prior.title??'')!==String(row.title??'')||
          String(prior.site_id??'')!==String(row.site_id??''))
        throw Error('相同 UID 對應不同來源文章，停止匯入：'+uid);
      duplicates++;aliases.set(uid,uid);inheritLocation(uid,row);continue;
    }
    byUid.set(uid,row);
    // The native source ID represents the same source post even if the export
    // accidentally contains multiple copies. Retain one canonical Galaxy UID.
    const source=importSourceKey(row);
    const sourceUid=source?byNativeId.get(source):null;
    if(sourceUid){duplicates++;aliases.set(uid,sourceUid);inheritLocation(sourceUid,row);continue;}
    if(source)byNativeId.set(source,uid);
    // For posts without a native ID, compare exact time and normalized text.
    let semantic=null;
    if(!source){
      const time=importTimeKey(row);
      if(time){
        const text=comparableImportText(row.content);
        if(text)semantic=JSON.stringify([time,text]);
      }
    }
    const seen=semantic?byContentTime.get(semantic):null;
    if(seen){duplicates++;aliases.set(uid,seen);inheritLocation(seen,row);continue;}
    if(semantic)byContentTime.set(semantic,uid);
    indexByUid.set(uid,unique.length);
    unique.push(row);aliases.set(uid,uid);
  }
  return {unique,aliases,duplicates};
}

export async function matchExistingImportBySiteId(records,{readSiteIds,onProgress}={}){
  if(typeof readSiteIds!=='function')throw Error('缺少 site_id 查詢');
  const requested=new Map(),groups=new Map();
  for(const record of records||[]){
    const key=importSourceKey(record);
    if(!key)continue;
    if(requested.has(key))throw Error('同一批匯入存在重複的來源 site_id：'+String(record.site_id));
    requested.set(key,record);
    const site=String(record.site).trim();
    if(!groups.has(site))groups.set(site,new Set());
    groups.get(site).add(String(record.site_id).trim());
  }
  const total=[...groups.values()].reduce((sum,ids)=>sum+ids.size,0);
  const matches=new Map(),candidates=new Map();
  onProgress?.({completed:0,total,matched:0});
  if(!total)return matches;
  const consumePage=page=>{
    if(!Array.isArray(page))throw Error('site_id 查詢結果無效');
    for(const row of page){
      const key=importSourceKey(row);
      if(!key||!requested.has(key))continue;
      const state=candidates.get(key)||new Map();
      // Database pages can overlap; a persisted UID is one candidate.
      state.set(String(row.uid),row);
      candidates.set(key,state);
    }
  };
  for(const [site,ids] of groups){
    // The third argument allows database readers to add .eq('site', site).
    const returned=await readSiteIds([...ids],consumePage,site);
    if(Array.isArray(returned))consumePage(returned);
    else if(returned!==undefined&&returned!==null)
      throw Error('site_id 查詢沒有回傳有效文章');
  }
  const ambiguous=[];
  for(const [key,record] of requested){
    const saved=[...(candidates.get(key)?.values()||[])];
    if(saved.length===1){
      matches.set(String(record.uid),saved[0]);
      continue;
    }
    if(saved.length<2)continue;
    // A reused platform ID must never select an arbitrary existing article.
    // Exact timestamps can distinguish duplicate stored IDs; a matching body
    // alone cannot, because distinct posts may carry the same text.
    const incomingTime=Date.parse(String(record.createtime??''));
    const sameInstant=Number.isFinite(incomingTime)?
      saved.filter(row=>Date.parse(String(row.createtime??''))===incomingTime):[];
    if(sameInstant.length===1){
      matches.set(String(record.uid),sameInstant[0]);
      continue;
    }
    // Do not abort the rest of a ZIP. Hold only this unresolved article and
    // report the conflict; never update, insert or attach media to a guess.
    ambiguous.push({
      uid:String(record.uid),site:String(record.site),
      site_id:String(record.site_id),createtime:record.createtime??null,
      saved_uids:saved.map(row=>String(row.uid))
    });
  }
  matches.ambiguous=ambiguous;
  onProgress?.({completed:total,total,matched:matches.size,ambiguous:ambiguous.length});
  return matches;
}

// Scope to the exact source site before querying timestamps. Neither content
// nor optional site_id participates in duplicate detection.
export async function matchExistingImportByCreatedAt(records,{readTimestamps,onProgress}={}){
  if(typeof readTimestamps!=='function')throw Error('缺少 createtime 查詢');
  const requested=new Map(),groups=new Map();
  for(const record of records||[]){
    const key=importTimeKey(record);
    if(!key)continue;
    if(!requested.has(key))requested.set(key,[]);
    requested.get(key).push(record);
    const site=String(record.site).trim();
    if(!groups.has(site))groups.set(site,new Set());
    groups.get(site).add(new Date(Date.parse(record.createtime)).toISOString());
  }
  const total=[...groups.values()].reduce((sum,times)=>sum+times.size,0);
  const matches=new Map(),candidates=new Map(),ambiguous=[];
  onProgress?.({completed:0,total,matched:0});
  if(!total)return matches;
  const consumePage=page=>{
    if(!Array.isArray(page))throw Error('createtime 查詢結果無效');
    for(const row of page){
      const key=importTimeKey(row);
      if(!key||!requested.has(key))continue;
      if(!candidates.has(key))candidates.set(key,new Map());
      candidates.get(key).set(String(row.uid),row);
    }
  };
  let base=0;
  for(const [site,times] of groups){
    const report=done=>onProgress?.({completed:Math.min(total,base+done),
      total,matched:candidates.size});
    const returned=await readTimestamps([...times],consumePage,site,report);
    base+=times.size;
    if(Array.isArray(returned))consumePage(returned);
    else if(returned!==undefined&&returned!==null)
      throw Error('createtime 查詢沒有回傳有效文章');
  }
  for(const [key,recordsAtTime] of requested){
    const saved=[...(candidates.get(key)?.values()||[])];
    if(!saved.length)continue;
    const used=new Set(),unresolved=[];
    // Index one same-second group once. Native IDs and normalized bodies
    // should not trigger a full scan for each imported post.
    const bySiteId=new Map();
    for(const row of saved){
      const id=String(row.site_id||'').trim();
      if(!id)continue;
      if(!bySiteId.has(id))bySiteId.set(id,[]);
      bySiteId.get(id).push(row);
    }
    const eligible=(record,rows)=>rows.filter(row=>{
      if(used.has(String(row.uid)))return false;
      const incomingId=String(record.site_id||'').trim();
      const storedId=String(row.site_id||'').trim();
      // Two different genuine platform IDs are different posts.
      return !incomingId||!storedId||incomingId===storedId;
    });
    const assign=(record,row)=>{
      matches.set(String(record.uid),row);used.add(String(row.uid));
    };
    // A source identifier is definitive even when multiple posts share time.
    for(const record of recordsAtTime){
      const id=String(record.site_id||'').trim();
      const equal=id?(bySiteId.get(id)||[]).filter(row=>!used.has(String(row.uid))):[];
      if(equal.length===1)assign(record,equal[0]);
      else if(equal.length>1)ambiguous.push({uid:String(record.uid),site:record.site,createtime:record.createtime});
      else unresolved.push(record);
    }
    // Build text groups only when native-ID matching left work to do.
    const byContent=new Map();
    if(unresolved.length)for(const row of saved){
      const text=comparableImportText(row.content);
      if(!byContent.has(text))byContent.set(text,[]);
      byContent.get(text).push(row);
    }
    for(const record of unresolved){
      const incomingText=comparableImportText(record.content);
      const sameContent=eligible(record,byContent.get(incomingText)||[]);
      if(sameContent.length===1){assign(record,sameContent[0]);continue;}
      if(sameContent.length>1){
        ambiguous.push({uid:String(record.uid),site:record.site,createtime:record.createtime});
        continue;
      }
      // A single timestamp on each side also supports an edited article.
      // Never guess when several different posts share the timestamp.
      const options=eligible(record,saved);
      if(recordsAtTime.length===1&&saved.length===1&&options.length===1)
        assign(record,options[0]);
      // No matching saved content: this is a distinct post, not a reason
      // to silently drop it from a bulk import.
    }
  }
  onProgress?.({completed:total,total,matched:matches.size});
  matches.ambiguous=ambiguous;
  return matches;
}

const importIsoTime=value=>{
  const date=Date.parse(String(value??''));
  return Number.isFinite(date)?new Date(date).toISOString():null;
};
// The comparison pool is one site's saved rows inside the incoming time span.
// Requested timestamps are sorted and cut into disjoint windows, so a saved row
// is scanned at most once. A window reads only uid + createtime; full rows are
// read by UID for the timestamps that really matched.
// Process disjoint source-time windows in exactly three bounded SELECT lanes.
// A timestamp belongs to only one lane. Each lane filters and fetches its own
// candidate UIDs; the shared comparison spool receives the completed results.
export async function readImportCandidatesByTimeWindows(times,
    {readWindow,readRowsByUid,consumePage,windowSize=5000,concurrency=3,onWindowDone,
      excludeUids=new Set()}={}){
  if(typeof readWindow!=='function'||typeof readRowsByUid!=='function'||
      typeof consumePage!=='function')throw Error('缺少時間區間查詢');
  if(!(excludeUids instanceof Set))throw Error('無效的既有 UID 排除索引');
  if(!Number.isSafeInteger(windowSize)||windowSize<1||windowSize>10000)
    throw Error('無效的比對區間大小');
  if(!Number.isSafeInteger(concurrency)||concurrency<1||concurrency>3)
    throw Error('比對 SELECT 最多只能同時執行三路');
  const sorted=[...new Set((times||[]).map(importIsoTime).filter(Boolean))].sort();
  if(!sorted.length)return;
  // Even a file with fewer than windowSize unique timestamps can use three
  // workers. Never split equal timestamps across two windows.
  const chunkSize=Math.max(1,Math.min(windowSize,Math.ceil(sorted.length/concurrency)));
  const windows=[];
  for(let index=0;index<sorted.length;index+=chunkSize)
    windows.push(sorted.slice(index,index+chunkSize));
  let next=0,completed=0;
  const work=async()=>{
    for(;;){
      const index=next++;
      if(index>=windows.length)return;
      const part=windows[index],wanted=new Set(part);
      // The SQL where-range and the local timestamp filter must agree.
      // This keeps each lane from consuming records belonging to other lanes.
      const saved=await readWindow(part[0],part[part.length-1]);
      if(!Array.isArray(saved))throw Error('時間區間查詢結果無效');
      const uids=new Set();
      // The source-ID stage already resolved these rows. Exclude them before
      // the expensive full-content UID SELECT, not after fetching the body.
      for(const row of saved){
        const uid=String(row?.uid||'');
        if(!excludeUids.has(uid)&&wanted.has(importIsoTime(row?.createtime)))
          uids.add(uid);
      }
      if(uids.size){
        const full=await readRowsByUid([...uids]);
        if(!Array.isArray(full))throw Error('UID 查詢結果無效');
        // A lane can only deposit records matched inside its own window.
        const requested=new Set(uids);
        consumePage(full.filter(row=>requested.has(String(row.uid))&&
          wanted.has(importIsoTime(row.createtime))));
      }
      completed+=part.length;
      onWindowDone?.(completed);
    }
  };
  // Settle all in-flight reads even if one fails, so a failed compare never
  // leaves detached read tasks racing the next import attempt.
  const workers=await Promise.allSettled(Array.from(
    {length:Math.min(concurrency,windows.length)},()=>work()));
  const failure=workers.find(worker=>worker.status==='rejected');
  if(failure)throw failure.reason;
}

export function isUnchangedImportBeforeWrite(records,matches,{hasMedia=false}={}){
  if(hasMedia||!Array.isArray(records)||!records.length||!(matches instanceof Map))return false;
  return records.every(record=>{
    const saved=matches.get(record.uid);
    if(!saved)return false;
    if(!importTimeKey(record)||importTimeKey(record)!==importTimeKey(saved))return false;
    if(String(saved.title||'')!==String(record.title||'')||
       String(saved.content||'')!==String(record.content||''))return false;
    // Equal text does not mean the import is a no-op when earlier rows lack
    // actual source metadata. Reimports should restore missing relationships.
    for(const field of ['site_id','location','url','ref_id','source_id'])
      if(!String(saved[field]||'').trim()&&String(record[field]||'').trim())return false;
    if(!(Array.isArray(saved.target_id)&&saved.target_id.length)&&
       Array.isArray(record.target_id)&&record.target_id.length)return false;
    return true;
  });
}

function isUidPrimaryKeyConflict(error){
  // LOC SQL Gateway hides server errors behind "Database request failed",
  // but passes through PostgreSQL SQLSTATE 23505 in error.code.
  const code=String(error?.code||error?.cause?.code||'');
  const constraint=String(error?.constraint||error?.cause?.constraint||'');
  if(code==='23505')return !constraint||/_pkey$/i.test(constraint);
  const message=String(error?.message||error||'');
  return /(?:23505|duplicate key|unique constraint|UNIQUE constraint failed)/i.test(message)
    &&/(?:_pkey|PRIMARY KEY|\.uid|uid[^a-z])/i.test(message);
}
// Bisect only real primary-key conflicts. Never turn an unrelated SQL error
// into a silent success. Batch commits stay bounded by the database gateway.
export async function insertImportBatches(records,{writeBatch,batchSize=200,onProgress,verifyUidConflict}={}){
  if(!Array.isArray(records)||typeof writeBatch!=='function')throw Error('無效匯入批次');
  if(!Number.isSafeInteger(batchSize)||batchSize<1||batchSize>10000)throw Error('無效批次大小');
  let completed=0,inserted=0,conflicts=0;
  const insertedUids=new Set(),conflictedUids=new Set();
  async function write(rows){
    try{
      const result=await writeBatch(rows);
      if(result&&Number.isInteger(result.count)&&result.count!==rows.length)
        throw Error('寫入筆數不符');
      inserted+=rows.length;
      for(const row of rows)insertedUids.add(String(row.uid));
    }catch(error){
      if(!isUidPrimaryKeyConflict(error))throw error;
      if(rows.length===1){
        const uid=String(rows[0].uid);
        const code=String(error?.code||error?.cause?.code||'');
        // A 23505 without the constraint name might refer to another UNIQUE
        // index. Require a real UID lookup before skipping this row.
        if(code==='23505'&&!String(error?.constraint||error?.cause?.constraint||'')){
          if(typeof verifyUidConflict!=='function'||!await verifyUidConflict(uid))throw error;
        }
        conflicts++;conflictedUids.add(uid);return;
      }
      const middle=Math.floor(rows.length/2);
      await write(rows.slice(0,middle));
      await write(rows.slice(middle));
    }
  }
  for(let i=0;i<records.length;i+=batchSize){
    const part=records.slice(i,i+batchSize);
    await write(part);
    completed+=part.length;
    onProgress?.({completed,total:records.length,inserted,conflicts});
  }
  return {completed,inserted,conflicts,insertedUids,conflictedUids};
}


