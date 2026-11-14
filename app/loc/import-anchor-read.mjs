// One authenticated, Scope-filtered Anchor scan for the existing import index.
// The 19 persisted types come from ZModel; this importer consumes Point/Date
// together without creating a parallel Anchor table or a semantic PK.
import {ANCHOR_TYPE_PROJECTIONS} from '../../zenstack/anchor-hierarchy.mjs';
import {dbAuthClient} from './db-client.mjs';
import {createImportPlaceIndex} from './import-place-anchors.mjs';
import {createImportDateIndex} from './import-time-anchors.mjs';

const TYPES=Object.freeze(['point','date']);
if(TYPES.some(type=>!ANCHOR_TYPE_PROJECTIONS[type]))
  throw Error('Point/Date ZModel Anchor projection is unavailable');

async function authorizedAnchorPage({scopeId,afterUid,limit}){
  // Managed actions use the existing Better Auth website Session and the
  // server's api.manage permission check. Never fetch private import evidence
  // via the anonymous /api/loc-public-query reader.
  const {data,error}=await dbAuthClient.schema('silver').managedAction(
    'anchor_import_page',{p_scope_id:scopeId,p_types:TYPES,
      p_after_uid:afterUid,p_limit:limit});
  if(error)throw Error('Anchor 授權讀取失敗：'+(error.message||error));
  return data;
}

export async function readImportPointDateAnchors({
  scopeId,pageSize=750,onProgress,readPage=authorizedAnchorPage
}={}){
  if(!/^[a-z][a-z0-9]{0,14}$/.test(String(scopeId||''))||
      scopeId==='local'||scopeId==='loc'||typeof readPage!=='function')
    throw Error('共用 Anchor 讀取來源無效');
  if(!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>750)
    throw Error('共用 Anchor 分頁大小無效');
  const table='silver.'+scopeId+'_anchor';
  const place=createImportPlaceIndex(),time=createImportDateIndex();
  const seen=new Set();
  let afterUid=null,completed=0;
  onProgress?.({phase:'讀取 Point／Date 共用定錨索引',completed:0,total:0});
  for(;;){
    const rows=await readPage({scopeId,afterUid,limit:pageSize});
    if(!Array.isArray(rows)||rows.length>pageSize)
      throw Error('共用 Anchor SELECT 回傳格式錯誤');
    for(const row of rows){
      const uid=String(row?.uid||'');
      // Only SQL may order Base62 under the database collation. JS lexical
      // comparison is not a valid replacement for the server UID cursor.
      if(!/^[A-Za-z0-9]{8}$/.test(uid)||seen.has(uid))
        throw Error('Point／Date Anchor UID 重複或無效：'+uid);
      seen.add(uid);
      afterUid=uid;
      if(row.type==='point')place.accept(row);
      else if(row.type==='date')time.accept(row);
      else throw Error('共用 Anchor SELECT 型別不符：'+String(row.type));
    }
    completed+=rows.length;
    onProgress?.({phase:'讀取 Point／Date 共用定錨索引',completed,total:0});
    if(rows.length<pageSize)break;
  }
  return {scopeId,table,place,time};
}
