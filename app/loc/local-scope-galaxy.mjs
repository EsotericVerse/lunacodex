// LOC Local Scope: the same browser-native IndexedDB primitive used by the
// Galaxy Link Extension, but with a dedicated Galaxy store (NOT its Queue).
// Nothing here imports cloud authentication, RPC, networking, or SQL drivers.
import {createSchemaFactory} from '@zenstackhq/zod';
import {schema} from '../../zenstack/schema.mjs';
import {galaxyReadColumns} from '../../zenstack/galaxy-read-models.mjs';
import {createUid8} from './uid.js';

export const LOCAL_GALAXY_DB='loc-local-galaxy-v1';
export const LOCAL_GALAXY_STORE='galaxy';
export const LOCAL_GALAXY_MAX_JSON_BYTES=16*1024*1024;
export const LOCAL_GALAXY_MAX_RECORDS=12000;
const UID=/^[A-Za-z0-9]{8}$/;
const FIELDS=new Set([...galaxyReadColumns('GalaxyUidRead'),'site_id']);
const validator=createSchemaFactory(schema).makeTypeSchema('GalaxyUidRead');

function dateValue(value,field){
  if(value==null||value==='')return null;
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))throw new Error('本機 Galaxy 日期無效：'+field);
  return date.toISOString();
}
export function normalizeLocalGalaxyRow(source={}){
  if(!source||typeof source!=='object'||Array.isArray(source))
    throw new Error('本機 Galaxy 文章格式無效');
  const row={};
  for(const key of Object.keys(source)){
    if(!FIELDS.has(key))throw new Error('本機 Galaxy 不支援欄位：'+key);
    row[key]=source[key];
  }
  row.uid=row.uid===undefined?createUid8():row.uid;
  if(typeof row.uid!=='string'||!UID.test(row.uid))
    throw new Error('本機 Galaxy UID 必須是八碼英數字');
  if(typeof row.content!=='string'||!row.content.trim())
    throw new Error('本機 Galaxy 文章不能沒有內容');
  for(const field of ['title','site','site_id','location','url','source_id','ref_id','place_id']){
    if(row[field]!=null&&typeof row[field]!=='string')
      throw new Error('本機 Galaxy 欄位必須為文字：'+field);
  }
  if(row.site==null||row.site==='')row.site='local';
  row.createtime=dateValue(row.createtime??new Date().toISOString(),'createtime');
  if(row.date!=null)row.date=dateValue(row.date,'date');
  for(const field of ['target_id','media_link']){
    if(row[field]!=null&&(!Array.isArray(row[field])||
        row[field].some(item=>typeof item!=='string'||!UID.test(item))))
      throw new Error('本機 Galaxy UID 清單無效：'+field);
  }
  // Validate against the actual shared ZenStack Galaxy read type. It is
  // a projection over the same fields, not a second hand-written model.
  const parsed=validator.safeParse({...row,
    createtime:new Date(row.createtime),
    ...(row.date?{date:new Date(row.date)}:{})
  });
  if(!parsed.success){
    const first=parsed.error.issues[0];
    throw new Error('Galaxy Z-model 驗證未通過：'+(first?.path||[]).join('.')+
      ' — '+(first?.message||'資料不符'));
  }
  return row;
}

export function parseLocalGalaxyArchive(payload){
  const raw=Array.isArray(payload)?payload:
    payload&&typeof payload==='object'&&!Array.isArray(payload)
      ?(payload.records??payload.galaxy):null;
  if(!Array.isArray(raw))throw new Error('請選擇 Galaxy JSON：文章陣列或 records 陣列');
  if(!raw.length)throw new Error('匯入檔案沒有文章');
  if(raw.length>LOCAL_GALAXY_MAX_RECORDS)
    throw new Error('單次匯入文章數超過裝置上限');
  const unique=new Set();
  const rows=raw.map((source,i)=>{
    let row;
    try{row=normalizeLocalGalaxyRow(source)}
    catch(error){throw new Error('第 '+(i+1)+' 筆：'+String(error.message||error))}
    if(unique.has(row.uid))throw new Error('匯入檔案含重複 UID：'+row.uid);
    unique.add(row.uid);return row;
  });
  return rows;
}

export async function openLocalGalaxy(){
  if(typeof indexedDB==='undefined')throw new Error('此裝置不支援 IndexedDB 本機資料庫');
  return await new Promise((resolve,reject)=>{
    const request=indexedDB.open(LOCAL_GALAXY_DB,1);
    request.onupgradeneeded=()=>{
      const db=request.result;
      if(!db.objectStoreNames.contains(LOCAL_GALAXY_STORE)){
        const store=db.createObjectStore(LOCAL_GALAXY_STORE,{keyPath:'uid'});
        store.createIndex('by_date','createtime');
        store.createIndex('by_site','site');
      }
    };
    request.onsuccess=()=>{
      const db=request.result;
      db.onversionchange=()=>db.close();
      resolve(db);
    };
    request.onerror=()=>reject(request.error||new Error('本機資料庫開啟失敗'));
    request.onblocked=()=>reject(new Error('本機資料庫正被其他視窗佔用'));
  });
}

export async function listLocalGalaxy(){
  const db=await openLocalGalaxy();
  try{return await new Promise((resolve,reject)=>{
    const tx=db.transaction(LOCAL_GALAXY_STORE,'readonly');
    const request=tx.objectStore(LOCAL_GALAXY_STORE).getAll();
    request.onsuccess=()=>resolve((request.result||[]).sort((a,b)=>
      String(b.createtime||'').localeCompare(String(a.createtime||''))||
      String(a.uid).localeCompare(String(b.uid))));
    request.onerror=()=>reject(request.error);
    tx.onabort=()=>reject(tx.error||new Error('本機資料讀取中斷'));
  });}finally{db.close();}
}

export async function importLocalGalaxy(rows){
  if(!Array.isArray(rows)||!rows.length||rows.length>LOCAL_GALAXY_MAX_RECORDS)
    throw new Error('本機匯入筆數無效');
  const prepared=parseLocalGalaxyArchive(rows);
  const db=await openLocalGalaxy();
  try{return await new Promise((resolve,reject)=>{
    const tx=db.transaction(LOCAL_GALAXY_STORE,'readwrite');
    const store=tx.objectStore(LOCAL_GALAXY_STORE);
    let updated=0,inserted=0,identityConflict=false;
    // Same-UID reimport updates only when source identity is compatible.
    // A conflicting UID must abort the ENTIRE IndexedDB transaction.
    for(const row of prepared){
      const prior=store.get(row.uid);
      prior.onsuccess=()=>{
        const saved=prior.result;
        if(saved&&((saved.site||'local')!==row.site||
            (saved.site_id||'')!==(row.site_id||''))){
          identityConflict=true;
          tx.abort();return;
        }
        if(saved)updated++;else inserted++;
        store.put(row);
      };
    }
    tx.oncomplete=()=>resolve({inserted,updated,total:prepared.length});
    tx.onerror=()=>reject(tx.error||new Error('本機資料庫寫入失敗'));
    tx.onabort=()=>reject(identityConflict
      ?new Error('UID 已對應其他來源，整批匯入取消；原資料未變更')
      :(tx.error||new Error('裝置資料庫交易中斷；原資料未變更')));
  });}finally{db.close();}
}

export async function importLocalGalaxyFile(file){
  if(!file||!Number.isFinite(file.size)||file.size<1||
      file.size>LOCAL_GALAXY_MAX_JSON_BYTES)
    throw new Error('僅支援 16 MiB 以下的 Galaxy JSON 檔案');
  let data;
  try{data=JSON.parse(await file.text());}
  catch{throw new Error('匯入檔案不是有效 JSON');}
  return importLocalGalaxy(parseLocalGalaxyArchive(data));
}

export async function exportLocalGalaxy(){
  const rows=await listLocalGalaxy();
  return JSON.stringify({format:'loc-local-galaxy',version:1,
    exported_at:new Date().toISOString(),records:rows},null,2);
}
