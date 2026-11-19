import {importGeoKey} from './geocoordinates.mjs';

// A native source ID is definitive. For original dated posts, source site +
// creation timestamp identifies a post. Fallback update times are not used
// to merge posts because multiple missing dates can share one edit time.
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
  const unique=[],aliases=new Map(),byUid=new Map(),byNativeId=new Map(),byTime=new Map();
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
    // Only an authentic creation timestamp can deduplicate same-site posts.
    // Multiple rows with missing time may share the same UpdateTime fallback.
    const time=row.__importTimeSource==='update'||
      row.__importTimeSource==='missing'?null:importTimeKey(row);
    const timeUid=time?byTime.get(time):null;
    if(timeUid){
      const saved=byUid.get(timeUid);
      const savedSource=importSourceKey(saved);
      // Two different real platform IDs cannot be overwritten by one another.
      if(!source||!savedSource||source===savedSource){
        duplicates++;aliases.set(uid,timeUid);inheritLocation(timeUid,row);
        continue;
      }
    }
    if(time&&!byTime.has(time))byTime.set(time,uid);
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


// The importer generates its own Galaxy UID on each import. Match original
// dated articles by source site + actual creation timestamp, not that UID or
// body/title/URL comparison. Missing creation times are handled separately.
const taipeiDate=new Intl.DateTimeFormat('sv-SE',{
  timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'
});
export async function matchExistingImportByCreatedAt(records,{
  readSourceRows,onProgress,excludeSavedUids=new Set()
}={}){
  if(typeof readSourceRows!=='function')
    throw new TypeError('Missing indexed source/date Galaxy reader');
  const groups=new Map(),requested=new Map();
  for(const row of records||[]){
    if(row.__importTimeSource==='update'||row.__importTimeSource==='missing')
      continue;
    const key=importTimeKey(row);
    if(!key)continue;
    const input=requested.get(key)||[];
    input.push(row);requested.set(key,input);
    const site=String(row.site||'').trim();
    const stamp=Date.parse(String(row.createtime||''));
    const day=taipeiDate.format(new Date(stamp));
    const group=groups.get(site)||{days:new Set(),wanted:new Set()};
    group.days.add(day);group.wanted.add(key);groups.set(site,group);
  }
  const matches=new Map(),ambiguous=[];
  for(const [site,group] of groups){
    const days=[...group.days].sort();
    const stored=new Map();
    await readSourceRows({
      site,fromDate:days[0],toDate:days.at(-1),
      consumePage:rows=>{
        if(!Array.isArray(rows))throw new TypeError('Invalid source/time page');
        for(const row of rows){
          const key=importTimeKey(row);
          if(!key||!group.wanted.has(key))continue;
          const candidates=stored.get(key)||new Map();
          candidates.set(String(row.uid),row);
          stored.set(key,candidates);
        }
      }
    });
    for(const key of group.wanted){
      const incoming=requested.get(key)||[];
      const candidates=[...(stored.get(key)?.values()||[])]
        .filter(row=>!excludeSavedUids.has(String(row.uid)));
      // A single true timestamp maps to a single existing source post.
      // If historic data has duplicate timestamps, do not choose randomly.
      if(incoming.length===1&&candidates.length===1)
        matches.set(String(incoming[0].uid),candidates[0]);
      else if(candidates.length)
        for(const row of incoming)ambiguous.push({
          uid:String(row.uid),site:String(row.site),createtime:row.createtime,
          saved_uids:candidates.map(candidate=>String(candidate.uid))
        });
    }
    onProgress?.({completed:matches.size,total:records.length,
      ambiguous:ambiguous.length});
  }
  matches.ambiguous=ambiguous;
  return matches;
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


