'use client';
import {dbAuthRelation} from './db-client.mjs';

const TABLE='silver.loc_user';
const COLUMNS='uid,owner_id,email,culture,statics,trace,search,keyword,user_setting,updated_at';
const UID=/^[A-Za-z0-9]{8}$/;
const KEYWORD=/^[a-z][a-z0-9]{0,30}:(?:[A-Za-z0-9]{4}|[A-Za-z0-9]{8})$/;
export const LOC_USER_FIELDS=Object.freeze(['culture','statics','trace','search','keyword']);
export const LOC_USER_DEFAULTS=Object.freeze({
  culture:Object.freeze({time:'era',display:'density',unit:'day',sort:'desc',list:false}),
  statics:Object.freeze({display:'source',unit:'day',sort:'desc',list:false}),
  trace:Object.freeze({display:'anchor',time:'none',sort:'desc',list:false}),
  search:Object.freeze({field:'content',sort:'asc',list:false}),
  keyword:'none'
});
const ALLOWED=Object.freeze({
  culture:{time:['anchor','period','era'],display:['density','keywords'],
    unit:['day','week','month','year'],sort:['asc','desc'],list:[false,true]},
  statics:{display:['source','media_type'],unit:['day','week','month','year'],sort:['asc','desc'],list:[false,true]},
  trace:{display:['anchor','path','trace'],time:['none','period','era'],sort:['desc','nearest'],list:[false,true]},
  search:{field:['content','title'],sort:['asc','desc'],list:[false,true]}
});
const normalizeEmail=value=>String(value||'').trim().toLowerCase();
function checked(value,label){
  if(value.error)throw new Error(value.error.message||label);
  return value.data;
}
export function normalizeLocUser(row={}){
  const source=row&&typeof row==='object'&&!Array.isArray(row)?row:{};
  const value={
    uid:String(source.uid||''),
    email:normalizeEmail(source.email),
    owner_id:String(source.owner_id||''),
    updated_at:String(source.updated_at||'')
  };
  for(const field of ['culture','statics','trace','search']){
    const raw=source[field]&&typeof source[field]==='object'&&!Array.isArray(source[field])
      ?source[field]:{};
    const normal={...LOC_USER_DEFAULTS[field]};
    for(const [key,choices] of Object.entries(ALLOWED[field])){
      if(choices.includes(raw[key]))normal[key]=raw[key];
    }
    value[field]=normal;
  }
  const selection=String(source.keyword||'none');
  value.keyword=selection==='none'||KEYWORD.test(selection)?selection:'none';
  return value;
}
export function validateLocUserField(field,value){
  if(!LOC_USER_FIELDS.includes(field))throw new Error('不允許修改這個個人設定欄位');
  if(field==='keyword'){
    if(value!=='none'&&!KEYWORD.test(String(value||'')))
      throw new Error('關鍵詞群組必須為無或 Scope 與四碼／八碼 UID');
    return value;
  }
  if(!value||typeof value!=='object'||Array.isArray(value))
    throw new Error('個人設定需為指定欄位的物件');
  const output={};
  for(const [key,choices] of Object.entries(ALLOWED[field])){
    if(!choices.includes(value[key]))throw new Error('個人設定內容不符合允許的選項');
    output[key]=value[key];
  }
  return output;
}
// RLS binds SELECT/INSERT/UPDATE to the signed-in JWT subject. Login is
// performed by the entry page; preferences do not recheck OAuth email.
async function selfRow(email){
  const verified=normalizeEmail(email);
  if(!verified)throw new Error('需要已驗證的 OAuth Email');
  const data=checked(await dbAuthRelation(TABLE).select(COLUMNS)
    .eq('email',verified).limit(1),'無法讀取 OAuth 個人設定');
  return data?.[0]||null;
}
// Reading missing preferences is normal. Do not create a row on login or
// during navigation; an OAuth user may have no stored preferences at all.
export async function loadOrCreateLocUser(email){
  return normalizeLocUser(await selfRow(email)||{});
}
export async function saveLocUserField(uid,field,value,email){
  const verified=normalizeEmail(email);
  if(!verified)throw new Error('需要已驗證的 OAuth Email');
  const normalized=validateLocUserField(field,value);
  if(uid&&!UID.test(String(uid)))throw new Error('個人設定 UID 必須為八碼');
  if(uid){
    const data=checked(await dbAuthRelation(TABLE)
      .update({[field]:normalized,updated_at:new Date().toISOString()})
      .eq('uid',uid).eq('email',verified).select(COLUMNS),'個人設定儲存失敗');
    if(!data?.length)throw new Error('個人設定已失效，請重新載入設定');
    return normalizeLocUser(data[0]);
  }
  // The very first explicit preference change creates the only row.
  // owner_id is supplied by the database from the authenticated JWT;
  // email is not used to authorize or identify the owner of preferences.
  const created=await dbAuthRelation(TABLE).insert([{[field]:normalized,email:verified}]).select(COLUMNS);
  if(!created.error){
    if(!created.data?.[0])throw new Error('個人設定未能建立');
    return normalizeLocUser(created.data[0]);
  }
  if(created.error.code!=='23505')
    throw new Error(created.error.message||'個人設定儲存失敗');
  // Another tab may have inserted the same owner's first row concurrently.
  const existing=await selfRow(verified);
  if(!existing)throw new Error('個人設定建立衝突，請重試');
  return saveLocUserField(existing.uid,field,normalized,verified);
}
