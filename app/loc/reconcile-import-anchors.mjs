import {prepareImportPlaceAnchors,importedPlaceId,recordImportPlaceVisits} from './import-place-anchors.mjs';
import {prepareImportTimeAnchors} from './import-time-anchors.mjs';

// Repair location/date links for articles already in Galaxy, without replaying
// an archive, creating duplicate posts, or touching unrelated article fields.
export async function reconcileExistingImportAnchors({
  scopeId,galaxy,timeTable,relation,updateImportRows,onProgress,pageSize=750
}={}){
  const scope=String(scopeId||'').trim();
  if(!/^[a-z][a-z0-9]{0,14}$/.test(scope)||scope==='loc'||scope==='local')
    throw Error('既有打卡修復 Scope 無效');
  if(typeof relation!=='function'||typeof updateImportRows!=='function'||
      !String(galaxy||'').startsWith('silver.'+scope+'_'))
    throw Error('既有打卡修復資料來源無效');
  const candidates=[];
  for(let offset=0;;offset+=pageSize){
    const {data,error}=await relation(galaxy)
      .select('uid,title,location,place_id,date,createtime')
      .or('location.neq."",place_id.neq.""')
      .order('createtime',{ascending:true}).range(offset,offset+pageSize-1);
    if(error)throw Error('讀取既有打卡文章失敗：'+(error.message||error));
    const page=data||[];
    if(!Array.isArray(page))throw Error('既有打卡文章格式錯誤');
    // Existing place_id is authoritative even if the article's original
    // location is empty or spelled differently from the kept Point title.
    candidates.push(...page.filter(row=>String(row.location||'').trim()||String(row.place_id||'').trim()));
    onProgress?.({phase:'核對既有地點文章',completed:offset+page.length,total:0});
    if(page.length<pageSize)break;
  }
  if(!candidates.length)return {scanned:0,linked:0,unmatched:0,
    places:{created:0,reused:0},dates:{created:0,reused:0},visits:0};
  // A known place_id already owns its location aliases. Do not create
  // another Point for each differently spelled location on a merged place.
  // Still collect those articles' timestamps below, keyed by the saved UID.
  const needingPlace=candidates.filter(row=>!String(row.place_id||'').trim());
  const places=await prepareImportPlaceAnchors(needingPlace,{
    scopeId:scope,relation,createMissing:true,scanExistingOnEmpty:true,onProgress
  });
  const dates=await prepareImportTimeAnchors(candidates,{
    scopeId:scope,timeTable,relation,
    includeUnifiedUidPool:true,onProgress
  });
  let linked=0,unmatched=0,updates=[];
  const visits=[];
  async function flush(){
    if(!updates.length)return;
    const pending=updates;
    updates=[];
    const written=await updateImportRows(galaxy,pending);
    if(Number(written?.count)!==pending.length)
      throw Error('既有打卡文章關聯更新筆數不符：'+Number(written?.count||0));
    linked+=pending.length;
    onProgress?.({phase:'補齊文章地點關聯',completed:linked,total:candidates.length});
  }
  for(const row of candidates){
    const saved=String(row.place_id||'').trim();
    // A validated existing Trace UID takes precedence over a name lookup,
    // which may be ambiguous when two different locations share a label.
    const matched=saved&&places.timesByUid?.has(saved)?saved:importedPlaceId({
      incoming:row,byName:places.byName,byCoordinate:places.byCoordinate
    });
    if(!matched){unmatched++;continue;}
    if(saved&&saved!==matched){unmatched++;continue;}
    if(!saved){
      updates.push({uid:String(row.uid),place_id:matched});
      if(updates.length>=200)await flush();
    }
    if(row.createtime)visits.push({uid:matched,time:row.createtime});
  }
  await flush();
  const recorded=await recordImportPlaceVisits(visits,{
    relation,table:places.table,timesByUid:places.timesByUid,
    createtimeByUid:places.createtimeByUid,attrsByUid:places.attrsByUid,onProgress
  });
  return {scanned:candidates.length,linked,unmatched,
    places:{created:places.created,reused:places.reused},
    dates:{created:dates.created,reused:dates.reused},
    visits:recorded.added};
}
