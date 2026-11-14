// Reuse one authorized, Scope-filtered read of the existing physical Anchor table.
// This does not introduce a new table, semantic PK, RPC or write permission.
import {ANCHOR_TYPE_PROJECTIONS} from '../../zenstack/anchor-hierarchy.mjs';
import {createImportPlaceIndex} from './import-place-anchors.mjs';
import {createImportDateIndex} from './import-time-anchors.mjs';

const TYPES=Object.freeze(['point','date']);
if(TYPES.some(type=>!ANCHOR_TYPE_PROJECTIONS[type]))
  throw Error('Point/Date ZModel Anchor projection is unavailable');

export async function readImportPointDateAnchors({
  scopeId,relation,pageSize=750,onProgress
}={}){
  if(!/^[a-z][a-z0-9]{0,14}$/.test(String(scopeId||''))||
      scopeId==='local'||scopeId==='loc'||typeof relation!=='function')
    throw Error('共用 Anchor 讀取來源無效');
  if(!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>1000)
    throw Error('共用 Anchor 分頁大小無效');
  const table='silver.'+scopeId+'_anchor';
  const place=createImportPlaceIndex(),time=createImportDateIndex();
  const seen=new Set();
  onProgress?.({phase:'讀取 Point／Date 共用定錨索引',completed:0,total:0});
  for(let offset=0;;){
    const {data,error}=await relation(table)
      .select('uid,type,title,description,attr,createtime')
      .in('type',TYPES).order('uid',{ascending:true})
      .range(offset,offset+pageSize-1);
    if(error)throw Error('讀取共用定錨失敗：'+(error.message||error));
    const rows=data||[];
    if(!Array.isArray(rows)||rows.length>pageSize)
      throw Error('共用 Anchor SELECT 回傳格式錯誤');
    for(const row of rows){
      const uid=String(row?.uid||'');
      if(!/^[A-Za-z0-9]{8}$/.test(uid)||seen.has(uid))
        throw Error('Point／Date Anchor UID 重複或無效：'+uid);
      seen.add(uid);
      if(row.type==='point')place.accept(row);
      else if(row.type==='date')time.accept(row);
      else throw Error('共用 Anchor SELECT 型別不符：'+String(row.type));
    }
    offset+=rows.length;
    onProgress?.({phase:'讀取 Point／Date 共用定錨索引',completed:offset,total:0});
    if(rows.length<pageSize)break;
  }
  return {scopeId,table,place,time};
}
