import {MAX_ROWS} from '../query/query-batch-size.mjs';
import {prepareImportPlaceAnchors,importedPlaceId} from './place-anchors.mjs';
import {prepareImportTimeAnchors} from './time-anchors.mjs';
import {readImportPointDateAnchors} from './anchor-read.mjs';
import {planImportPointUidLink} from './uid-delta.mjs';
import {queryImportAnchorArticlesPage} from '../actions/import/queries.mjs';

// Repair location/date links for articles already in Galaxy, without replaying
// an archive, creating duplicate posts, or touching unrelated article fields.
export async function reconcileExistingImportAnchors({
  scopeId,galaxy,timeTable,relation,updateImportRows,onProgress,pageSize=MAX_ROWS
}={}){
  const scope=String(scopeId||'').trim();
  if(!/^[a-z][a-z0-9]{0,14}$/.test(scope)||scope==='loc'||scope==='local')
    throw Error('既有打卡修復 Scope 無效');
  if(typeof relation!=='function'||typeof updateImportRows!=='function'||
      !String(galaxy||'').startsWith('silver.'+scope+'_'))
    throw Error('既有打卡修復資料來源無效');
  const candidates=[];
  let afterUid=null;
  for(;;){
    const {data}=await queryImportAnchorArticlesPage({p_scope_id:scope,
      p_after_uid:afterUid,p_limit:pageSize});
    const page=data||[];
    if(!Array.isArray(page)||page.length>pageSize)
      throw Error('既有打卡文章格式錯誤');
    // Existing place_id is authoritative even if the article's original
    // location is empty or spelled differently from the kept Point title.
    candidates.push(...page.filter(row=>String(row.location||'').trim()||String(row.place_id||'').trim()));
    onProgress?.({phase:'核對既有地點文章',completed:candidates.length,total:0});
    if(page.length<pageSize)break;
    const next=String(page.at(-1)?.uid||'');
    if(!/^[A-Za-z0-9]{8}$/.test(next)||next===afterUid)
      throw Error('既有打卡文章 UID 游標未前進');
    afterUid=next;
  }
  if(!candidates.length)return {scanned:0,linked:0,unmatched:0,
    places:{created:0,reused:0},dates:{created:0,reused:0}};
  // A known place_id already owns its location aliases. Do not create
  // another Point for each differently spelled location on a merged place.
  // Still collect those articles' timestamps below, keyed by the saved UID.
  const needingPlace=candidates.filter(row=>!String(row.place_id||'').trim());
  const savedPointUids=[...new Set(candidates.map(row=>row.place_id).filter(uid=>
    typeof uid==='string'&&/^[A-Za-z0-9]{8}$/.test(uid)))];
  const anchorSnapshot=await readImportPointDateAnchors({
    scopeId:scope,pageSize,onProgress,
    ...(needingPlace.length?{}:{pointUids:savedPointUids})
  });
  const places=await prepareImportPlaceAnchors(needingPlace,{
    scopeId:scope,relation,createMissing:true,scanExistingOnEmpty:true,onProgress,anchorSnapshot
  });
  const dates=await prepareImportTimeAnchors(candidates,{
    scopeId:scope,timeTable,relation,
    includeUnifiedUidPool:true,onProgress,anchorSnapshot
  });
  let linked=0,unmatched=0,updates=[];
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
    const matched=saved&&places.knownPointUids?.has(saved)?saved:importedPlaceId({
      incoming:row,byName:places.byName,byCoordinate:places.byCoordinate
    });
    if(!matched){unmatched++;continue;}
    if(saved&&saved!==matched){unmatched++;continue;}
    if(!saved){
      const {changes,patches}=planImportPointUidLink(null,matched);
      if(patches.length){
        updates.push({uid:String(row.uid),...changes});
        if(updates.length>=200)await flush();
      }
    }
  }
  await flush();
  return {scanned:candidates.length,linked,unmatched,
    places:{created:places.created,reused:places.reused,
      conflicts:places.conflicts||[]},
    dates:{created:dates.created,reused:dates.reused,
      conflicts:dates.conflicts||[]}};
}
