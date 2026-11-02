'use client';
import {dbAuthRelation,getAccountSession} from './db-client.mjs';

const TABLE='api.loc_user';
const COLUMNS='uid,owner_id,email,culture,statics,trace,search,keyword,updated_at';
const UID=/^[A-Za-z0-9]{8}$/;
const KEYWORD=/^[a-z][a-z0-9]{0,30}:(?:[A-Za-z0-9]{4}|[A-Za-z0-9]{8})$/;
export const LOC_USER_FIELDS=Object.freeze(['culture','statics','trace','search','keyword']);
export const LOC_USER_DEFAULTS=Object.freeze({
  culture:Object.freeze({time:'era',display:'density',unit:'day',sort:'desc'}),
  statics:Object.freeze({display:'source',unit:'day',sort:'desc'}),
  trace:Object.freeze({display:'anchor',time:'none',sort:'desc'}),
  search:Object.freeze({field:'content',sort:'asc'}),
  keyword:'none'
});
const ALLOWED=Object.freeze({
  culture:{time:['anchor','period','era'],display:['density','keywords'],
    unit:['day','week','month','year'],sort:['asc','desc']},
  statics:{display:['source','media_type'],unit:['day','week','month','year'],sort:['asc','desc']},
  trace:{display:['anchor','path','trace'],time:['none','period','era'],sort:['desc','nearest']},
  search:{field:['content','title'],sort:['asc','desc']}
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
async function verifiedOAuth(){
  // The identity is verified by Clerk Authority / the active OAuth provider.
  // Never trust a local SDK event's email for the stored user record.
  const session=await getAccountSession();
  const subject=String(session?.user?.id||'');
  const email=normalizeEmail(session?.oauth?.email);
  if(!subject||!email)throw new Error('請先完成 OAuth 登入驗證');
  return {subject,email};
}
async function selfRow(){
  const data=checked(await dbAuthRelation(TABLE).select(COLUMNS).limit(1),
    '無法讀取 OAuth 個人設定');
  return data?.[0]||null;
}
// Called once after a verified OAuth sign-in. Guests never call this.
// RLS binds the inserted owner_id to the signed JWT sub (server default).
// A simultaneous first sign-in cannot create two rows: owner_id is unique.
export async function loadOrCreateLocUser(){
  const identity=await verifiedOAuth();
  let row=await selfRow();
  if(row&&String(row.owner_id)!==identity.subject)
    throw new Error('OAuth 個人設定的帳號與目前登入者不一致');
  if(!row){
    const created=await dbAuthRelation(TABLE)
      .insert([{email:identity.email}]).select(COLUMNS);
    if(created.error){
      if(created.error.code!=='23505')throw new Error(created.error.message||'無法建立個人設定');
      // Two devices can finish the same OAuth login concurrently.
      row=await selfRow();
      if(!row)throw new Error('個人設定建立衝突，請重試');
    }else row=created.data?.[0]||null;
  }
  if(!row||!UID.test(String(row.uid||'')))
    throw new Error('OAuth 個人設定 UID 格式錯誤');
  if(String(row.owner_id)!==identity.subject)
    throw new Error('OAuth 個人設定與登入身分不符');
  if(normalizeEmail(row.email)!==identity.email){
    const data=checked(await dbAuthRelation(TABLE)
      .update({email:identity.email,updated_at:new Date().toISOString()})
      .eq('uid',row.uid).select(COLUMNS),'無法更新 OAuth 郵件');
    row=data?.[0]||row;
  }
  return normalizeLocUser(row);
}
export async function saveLocUserField(uid,field,value){
  const identity=await verifiedOAuth();
  if(!UID.test(String(uid||'')))throw new Error('個人設定 UID 必須為八碼');
  const normalized=validateLocUserField(field,value);
  // Only a single category is updated per request; editing Culture cannot
  // overwrite a concurrent Statistics or Search preference.
  const data=checked(await dbAuthRelation(TABLE)
    .update({[field]:normalized,updated_at:new Date().toISOString()})
    .eq('uid',uid).eq('owner_id',identity.subject).select(COLUMNS),
    '個人設定儲存失敗');
  if(!data?.length)throw new Error('個人設定已失效或登入帳號已變更');
  return normalizeLocUser(data[0]);
}
