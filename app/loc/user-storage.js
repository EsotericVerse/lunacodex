'use client';

// Personal navigation settings are columns of ONE silver.loc_user row.
// No personal diary, rune-draw archive, or separate user_settings relation.
import {dbAuthRelation} from './db-client.mjs';

const TABLE='silver.loc_user';
const NAV_SETTINGS_CACHE_KEY='loc-navigation-setting-snapshot-v1';
function invalidate(){
  try{if(typeof window!=='undefined')window.sessionStorage.removeItem(NAV_SETTINGS_CACHE_KEY);}catch{}
}
async function personalSettingsRow(){
  // A website-private data request must not fetch or create LOC Auth sessions.
  const {data,error}=await dbAuthRelation(TABLE)
    .select('uid,user_setting,updated_at').limit(1);
  if(error)throw new Error(error.message||'個人設定讀取失敗');
  return data?.[0]||null;
}
const settingsMap=row=>row?.user_setting&&typeof row.user_setting==='object'&&
  !Array.isArray(row.user_setting)?row.user_setting:{};
function valueOf(settings,key){
  if(!Object.hasOwn(settings,key))return null;
  const value=settings[key];
  if(key==='loc-ui-settings-v1'){
    const object=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
    return {draw_response:String(object.draw_response||'ritual'),
      ...(Number.isFinite(Number(object.list_page_size))?
        {list_page_size:Number(object.list_page_size)}:{})};
  }
  if(key==='loc-locale-v1')return value||'zh-Hant';
  return value??null;
}
function checkedSetting(key,value){
  if(!key||key.length>120)throw new Error('設定鍵值無效');
  if(key==='loc-ui-settings-v1'){
    const object=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
    return {draw_response:String(object.draw_response||'ritual'),
      ...(Number.isFinite(Number(object.list_page_size))?
        {list_page_size:Number(object.list_page_size)}:{})};
  }
  if(key==='loc-locale-v1')return String(value||'zh-Hant');
  if(value===null||typeof value==='boolean'||typeof value==='string'||
      typeof value==='number'&&Number.isFinite(value))return value;
  throw new Error('個人設定只能儲存簡單值');
}
export async function getSettings(keys=[],identity=''){
  const names=[...new Set((Array.isArray(keys)?keys:[])
    .map(key=>String(key||'').trim()).filter(Boolean))];
  if(!names.length)return {};
  if(identity&&typeof window!=='undefined')try{
    const cached=JSON.parse(window.sessionStorage.getItem(NAV_SETTINGS_CACHE_KEY)||'null');
    if(cached?.identity===identity&&names.every(key=>Object.hasOwn(cached.values||{},key)))
      return Object.fromEntries(names.map(key=>[key,cached.values[key]]));
  }catch{}
  const row=await personalSettingsRow();
  const settings=settingsMap(row);
  const values=Object.fromEntries(names.map(key=>[key,valueOf(settings,key)]));
  if(identity&&typeof window!=='undefined')try{
    window.sessionStorage.setItem(NAV_SETTINGS_CACHE_KEY,JSON.stringify({identity,values}));
  }catch{}
  return values;
}
export async function getSetting(key){
  const name=String(key||'').trim();
  if(!name)return null;
  return valueOf(settingsMap(await personalSettingsRow()),name);
}
async function changeSetting(key,operation,value){
  const name=String(key||'').trim();
  if(!name||name.length>120)throw new Error('設定鍵值無效');
  const checked=operation==='delete'?null:checkedSetting(name,value);
  const row=await personalSettingsRow();
  const next={...settingsMap(row)};
  if(operation==='delete')delete next[name];
  else next[name]=checked;
  if(JSON.stringify(next).length>16000)throw new Error('個人設定資料過大');
  const values={user_setting:next,updated_at:new Date().toISOString()};
  let result;
  if(row?.uid){
    result=await dbAuthRelation(TABLE).update(values)
      .eq('uid',row.uid).select('uid,user_setting');
    if(!result.error&&!result.data?.length)
      throw new Error('個人設定更新失敗，請重新載入');
  }else if(operation!=='delete'){
    result=await dbAuthRelation(TABLE).insert([values])
      .select('uid,user_setting');
    // Another tab may create the same owner's row concurrently.
    if(result.error?.code==='23505'){
      const existing=await personalSettingsRow();
      if(!existing?.uid)throw new Error('個人設定建立衝突');
      const merged={...settingsMap(existing),[name]:checked};
      result=await dbAuthRelation(TABLE).update({
        user_setting:merged,updated_at:new Date().toISOString()
      }).eq('uid',existing.uid).select('uid,user_setting');
    }
  }
  if(result?.error)throw new Error(result.error.message||'個人設定儲存失敗');
  invalidate();
  return operation==='delete'?undefined:valueOf(settingsMap(result?.data?.[0]||{user_setting:next}),name);
}
export async function putSetting(key,value){return changeSetting(key,'put',value);}
export async function deleteSetting(key){return changeSetting(key,'delete');}
