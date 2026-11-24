// One authenticated, Scope-filtered Anchor scan for the existing import index.
// The 19 persisted types come from ZModel; this importer consumes Point/Date
// together without creating a parallel Anchor table or a semantic PK.
import {ANCHOR_TYPE_PROJECTIONS} from '../../../packages/zenstack/anchor-hierarchy.mjs';
import {MAX_ROWS,TIME_ANCHOR_MAX_PAGE_ROWS,createTextAdaptiveRows} from '../query/query-batch-size.mjs';
import {dbAuthClient,dbAuthRelation} from '../db/db-client.mjs';
import {createImportPlaceIndex} from './place-anchors.mjs';
import {createImportDateIndex} from './time-anchors.mjs';

const TYPES=Object.freeze(['point','date']);
if(TYPES.some(type=>!ANCHOR_TYPE_PROJECTIONS[type]))
  throw Error('Point/Date ZModel Anchor projection is unavailable');

async function authorizedAnchorPage({scopeId,afterUid,limit,types=TYPES}){
  // Managed actions use the existing Better Auth website Session and the
  // server's published JavaScript permission check. Never fetch private import evidence
  // through the feature-owned Trace query action.
  const {data,error}=await dbAuthClient.schema('silver').managedAction(
    'anchor_import_page',{p_scope_id:scopeId,p_types:types,
      p_after_uid:afterUid,p_limit:limit});
  if(error)throw Error('Anchor 授權讀取失敗：'+(error.message||error));
  return data;
}

// With pointUids, reuse the exact saved Point PKs and scan only Date rows.
// Full Point scanning is necessary only for *new* places needing discovery.
// This is an import-only read optimization; it does not weaken Scope auth.
async function authorizedPointUidRows({scopeId,uids}){
  const table='silver.'+scopeId+'_anchor',rows=[];
  for(let offset=0;offset<uids.length;offset+=MAX_ROWS){
    const chunk=uids.slice(offset,offset+MAX_ROWS);
    const {data,error}=await dbAuthRelation(table)
      .select('uid,type,title,attr,createtime').in('uid',chunk).eq('type','point');
    if(error)throw Error('Point UID 主鍵核對失敗：'+(error.message||error));
    if(!Array.isArray(data)||data.length>chunk.length)
      throw Error('Point UID 主鍵 SELECT 回傳格式錯誤');
    const requested=new Set(chunk);
    if(data.some(row=>!requested.has(String(row?.uid||''))||row.type!=='point'))
      throw Error('Point UID 主鍵 SELECT 回傳不屬於本次 Scope');
    rows.push(...data);
  }
  return rows;
}

export async function readImportPointDateAnchors({
  scopeId,pageSize=MAX_ROWS,onProgress,readPage=authorizedAnchorPage,
  pointUids=null,readPointUids=authorizedPointUidRows
}={}){
  if(!/^[a-z][a-z0-9]{0,14}$/.test(String(scopeId||''))||
      scopeId==='local'||scopeId==='loc'||typeof readPage!=='function')
    throw Error('共用 Anchor 讀取來源無效');
  if(!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>TIME_ANCHOR_MAX_PAGE_ROWS)
    throw Error('共用 Anchor 分頁大小無效');
  if(pointUids!==null&&(!Array.isArray(pointUids)||
      pointUids.some(uid=>typeof uid!=='string'||!/^[A-Za-z0-9]{8}$/.test(uid))||
      typeof readPointUids!=='function'))
    throw Error('Point UID 主鍵查詢參數無效');
  const requestedPointUids=pointUids===null?null:[...new Set(pointUids)];
  const types=requestedPointUids===null?TYPES:['date'];
  const table='silver.'+scopeId+'_anchor';
  const place=createImportPlaceIndex(),time=createImportDateIndex();
  const seen=new Set();
  let afterUid=null,completed=0;
  const sizer=createTextAdaptiveRows({initial:pageSize,maximum:TIME_ANCHOR_MAX_PAGE_ROWS});
  onProgress?.({phase:requestedPointUids===null?'讀取 Point／Date 共用定錨索引':'讀取 Date 定錨及指定 Point UID',completed:0,total:0});
  for(;;){
    const requested=sizer.size;
    const rows=await readPage({scopeId,afterUid,limit:requested,types});
    if(!Array.isArray(rows)||rows.length>requested)
      throw Error('共用 Anchor SELECT 回傳格式錯誤');
    for(const row of rows){
      const uid=String(row?.uid||'');
      // Only SQL may order Base62 under the database collation. JS lexical
      // comparison is not a valid replacement for the server UID cursor.
      if(!/^[A-Za-z0-9]{8}$/.test(uid)||seen.has(uid))
        throw Error('Point／Date Anchor UID 重複或無效：'+uid);
      seen.add(uid);
      afterUid=uid;
      if(row.type==='point'&&requestedPointUids===null)place.accept(row);
      else if(row.type==='date')time.accept(row);
      else throw Error('共用 Anchor SELECT 型別不符：'+String(row.type));
    }
    completed+=rows.length;
    if(rows.length)sizer.observe(rows.length,rows.reduce((sum,row)=>sum+JSON.stringify(row).length,0));
    onProgress?.({phase:'讀取 Point／Date 共用定錨索引',completed,total:0});
    if(rows.length<requested)break;
  }
  if(requestedPointUids?.length){
    const points=await readPointUids({scopeId,uids:requestedPointUids});
    if(!Array.isArray(points)||points.length>requestedPointUids.length)
      throw Error('Point UID 主鍵 SELECT 回傳格式錯誤');
    const requested=new Set(requestedPointUids);
    for(const row of points){
      const uid=String(row?.uid||'');
      if(!requested.has(uid)||seen.has(uid)||row.type!=='point')
        throw Error('Point UID 主鍵重複或型別不符：'+uid);
      seen.add(uid);
      place.accept(row);
    }
    onProgress?.({phase:'確認既有 Point UID',completed:points.length,total:requestedPointUids.length});
  }
  return {scopeId,table,place,time};
}
