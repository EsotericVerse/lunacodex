'use client';

// All web-user preferences live on one owner-scoped LOC Session row.
// Stable setting keys remain a UI API; the database stores one scalar column
// per preference rather than a key/value table or a JSON settings bag.
import {dbAuthRelation} from '../db/db-client.mjs';

const TABLE='silver.loc_user';
const COLUMNS=Object.freeze({
  'loc-ui-settings-v1':['draw_response','list_page_size'],
  'loc-locale-v1':['locale']
});

const keyColumns=key=>COLUMNS[String(key||'').trim()]||null;
function rowValue(row,key){
  if(!row)return null;
  if(key==='loc-ui-settings-v1'){
    const value={draw_response:String(row.draw_response||'ritual')};
    if(row.list_page_size!=null&&Number.isInteger(Number(row.list_page_size)))
      value.list_page_size=Number(row.list_page_size);
    return value;
  }
  if(key==='loc-locale-v1')return row.locale||'zh-Hant';
  return row[keyColumns(key)?.[0]]??null;
}
function nextSetting(key,value){
  if(key==='loc-ui-settings-v1'){
    const data=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
    const n=data.list_page_size==null?null:Number(data.list_page_size);
    if(n!==null&&(!Number.isSafeInteger(n)||n<0))
      throw Error('個人設定的頁面筆數必須是非負整數');
    return {draw_response:String(data.draw_response||'ritual'),list_page_size:n};
  }
  if(key==='loc-locale-v1')return {locale:String(value||'zh-Hant')};
  if(value!==null&&value!==undefined&&typeof value!=='string')
    throw Error('此個人設定必須是文字值');
  return {[keyColumns(key)[0]]:value==null?null:value};
}

export async function getSettings(keys=[]){
  const names=[...new Set((Array.isArray(keys)?keys:[])
    .map(key=>String(key||'').trim()).filter(Boolean))];
  if(!names.length)return {};
  const columns=[...new Set(names.flatMap(key=>keyColumns(key)||[]))];
  if(!columns.length)return Object.fromEntries(names.map(key=>[key,null]));
  // Only active personal options are queried; obsolete navigation preferences are retired.
  const {data,error}=await dbAuthRelation(TABLE).select(columns.join(',')).limit(1);
  if(error)throw Error(error.message||'個人設定讀取失敗');
  const row=data?.[0]||null;
  return Object.fromEntries(names.map(key=>[key,keyColumns(key)?rowValue(row,key):null]));
}

export async function getSetting(key){
  const name=String(key||'').trim();
  return (await getSettings([name]))[name]??null;
}

export async function putSetting(key,value){
  const name=String(key||'').trim();
  if(!keyColumns(name))throw Error('不支援的個人設定項目');
  // Session identity and owner_id are enforced in the server endpoint.
  // Never ask for a management grant or accept an owner_id from the browser.
  const row={...nextSetting(name,value),updated_at:new Date().toISOString()};
  const {data,error}=await dbAuthRelation(TABLE)
    .upsert([row],{onConflict:'owner_id'})
    .select([...keyColumns(name),'updated_at'].join(','));
  if(error)throw Error(error.message||'個人設定儲存失敗');
  if(!data?.[0])throw Error('個人設定儲存後沒有回傳紀錄');
  return rowValue(data[0],name);
}

export async function deleteSetting(key){
  const name=String(key||'').trim();
  const columns=keyColumns(name);
  if(!columns)throw Error('不支援的個人設定項目');
  // Deleting one setting must never delete the entire LOC user record.
  const {data:existing,error:loadError}=await dbAuthRelation(TABLE)
    .select('uid').limit(1);
  if(loadError)throw Error(loadError.message||'個人設定讀取失敗');
  if(!existing?.[0]?.uid)return;
  const values=Object.fromEntries(columns.map(column=>[column,null]));
  const {error}=await dbAuthRelation(TABLE)
    .update({...values,updated_at:new Date().toISOString()})
    .eq('uid',existing[0].uid).select('uid');
  if(error)throw Error(error.message||'個人設定刪除失敗');
}
