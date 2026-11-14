'use client';

import {getAccountSession,dbAuthRelation} from './db-client.mjs';
import {applyFilters} from './db-query.mjs';


function apiRelation(name){return dbAuthRelation('api.'+name);}
const RECORD_COLUMNS=[
  'id','record_type','record_kind','source','record_date','scope_id',
  'mode','mode_label','moon_phase','trend','result','guidance','daily_role',
  'card_numbers','card_names','card_positions','card_directions',
  'card_attributes','card_states','positive_keywords','negative_keywords',
  'created_at','updated_at'
].join(',');

async function requireUser(){
  const session=await getAccountSession();
  if(!session?.user)throw new Error('請先登入帳號');
  return session.user;
}

function normalizeRecord(record={}){
  return {
    ...record,
    id:String(record.id||'').trim(),
    type:String(record.type||record.record_type||'record').trim(),
    updated_at:new Date().toISOString(),
    created_at:record.created_at||new Date().toISOString()
  };
}

function cardsFromRow(row={}){
  const numbers=Array.isArray(row.card_numbers)?row.card_numbers:[];
  const names=Array.isArray(row.card_names)?row.card_names:[];
  const positions=Array.isArray(row.card_positions)?row.card_positions:[];
  const directions=Array.isArray(row.card_directions)?row.card_directions:[];
  const attributes=Array.isArray(row.card_attributes)?row.card_attributes:[];
  const states=Array.isArray(row.card_states)?row.card_states:[];
  const positives=Array.isArray(row.positive_keywords)?row.positive_keywords:[];
  const negatives=Array.isArray(row.negative_keywords)?row.negative_keywords:[];
  const size=Math.max(numbers.length,names.length,positions.length,directions.length,attributes.length,states.length,positives.length,negatives.length);
  return Array.from({length:size},(_,index)=>({
    number:Number(numbers[index]??0),
    name:names[index]??'',
    position:positions[index]??'',
    direction:directions[index]??'',
    card_attribute:attributes[index]??'',
    state:states[index]??'',
    positive_keywords:positives[index]??'',
    negative_keywords:negatives[index]??''
  }));
}

function dbRecord(row={}){
  return {
    id:row.id,
    type:row.record_type,
    record_kind:row.record_kind??null,
    source:row.source??null,
    record_date:row.record_date??null,
    scope_id:row.scope_id??null,
    mode:row.mode??null,
    mode_label:row.mode_label??null,
    moon_phase:row.moon_phase??null,
    trend:row.trend??null,
    result:row.result??null,
    guidance:row.guidance??null,
    daily_role:row.daily_role??null,
    cards:cardsFromRow(row),
    created_at:row.created_at??null,
    updated_at:row.updated_at??null
  };
}

function dbRecordRow(row){
  const cards=Array.isArray(row.cards)?row.cards:[];
  return {
    id:row.id,
    record_type:row.type,
    record_kind:row.record_kind||null,
    source:row.source||null,
    record_date:row.record_date||null,
    scope_id:row.scope_id||null,
    mode:row.mode||null,
    mode_label:row.mode_label||null,
    moon_phase:row.moon_phase||null,
    trend:row.trend||null,
    result:row.result||null,
    guidance:row.guidance||null,
    daily_role:row.daily_role||null,
    card_numbers:cards.map(card=>Number(card?.number)||0),
    card_names:cards.map(card=>String(card?.name||'')),
    card_positions:cards.map(card=>String(card?.position||'')),
    card_directions:cards.map(card=>String(card?.direction||'')),
    card_attributes:cards.map(card=>String(card?.card_attribute||'')),
    card_states:cards.map(card=>String(card?.state||'')),
    positive_keywords:cards.map(card=>String(card?.positive_keywords||'')),
    negative_keywords:cards.map(card=>String(card?.negative_keywords||'')),
    created_at:row.created_at,
    updated_at:row.updated_at
  };
}

function dateKey(value){
  const date=value?new Date(value):new Date();
  if(Number.isNaN(date.getTime()))return '';
  const y=date.getFullYear(),m=String(date.getMonth()+1).padStart(2,'0'),d=String(date.getDate()).padStart(2,'0');
  return `${y}-${m}-${d}`;
}

function randomRecordId(prefix='record'){
  const suffix=globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${suffix}`;
}

export async function listRecords(type='',{
  recordKind='',
  recordDate='',
  offset=0,
  limit=20,
  count=false
}={}){
  await requireUser();
  const filters=[];
  if(type)filters.push({column:'record_type',operator:'eq',value:type});
  if(recordKind)filters.push({column:'record_kind',operator:'eq',value:recordKind});
  if(recordDate)filters.push({column:'record_date',operator:'eq',value:recordDate});
  let totalCount=null;
  if(count){
    let countQuery=apiRelation('user_records').select('id',{count:'exact',head:true});
    countQuery=applyFilters(countQuery,filters);
    const {error:countError,count:total}=await countQuery;
    if(countError)throw new Error(countError.message||'個人紀錄筆數讀取失敗');
    totalCount=Number(total||0);
  }
  let query=apiRelation('user_records').select(RECORD_COLUMNS);
  query=applyFilters(query,filters).order('updated_at',{ascending:false}).range(offset,offset+limit-1);
  const {data,error}=await query;
  if(error)throw new Error(error.message||'個人紀錄讀取失敗');
  const rows=(data||[]).map(dbRecord);
  return count?{rows,totalCount}:rows;
}

export async function putRecord(record){
  await requireUser();
  const row=normalizeRecord(record);
  if(!row.id)throw new Error('record.id is required');
  const dbRow=dbRecordRow(row);
  const {data,error}=await apiRelation('user_records').upsert([dbRow],{onConflict:'owner_id,id'}).select(RECORD_COLUMNS);
  if(error)throw new Error(error.message||'個人紀錄儲存失敗');
  return dbRecord(data?.[0]||dbRow);
}

function settingRow(key,value){
  const settingKey=String(key||'').trim();
  if(!settingKey)throw new Error('setting key is required');
  if(settingKey==='loc-ui-settings-v1'){
    const source=value&&typeof value==='object'?value:{};
    return {
      setting_key:settingKey,
      text_value:String(source.draw_response||'ritual'),
      integer_value:Number.isFinite(Number(source.list_page_size))?Number(source.list_page_size):null,
      updated_at:new Date().toISOString()
    };
  }
  if(settingKey==='loc-locale-v1'){
    return {
      setting_key:settingKey,
      text_value:String(value||'zh-Hant'),
      integer_value:null,
      updated_at:new Date().toISOString()
    };
  }
  if(typeof value==='number'&&Number.isFinite(value)){
    return {setting_key:settingKey,text_value:null,integer_value:value,updated_at:new Date().toISOString()};
  }
  if(value===null||value===undefined||typeof value==='string'||typeof value==='boolean'){
    return {setting_key:settingKey,text_value:value===null||value===undefined?null:String(value),integer_value:null,updated_at:new Date().toISOString()};
  }
  throw new Error('此設定需要明確欄位，不接受 JSON 物件。');
}

function settingValue(row,key){
  if(!row)return null;
  if(key==='loc-ui-settings-v1'){
    const value={draw_response:String(row.text_value||'ritual')};
    if(Number.isFinite(Number(row.integer_value)))value.list_page_size=Number(row.integer_value);
    return value;
  }
  if(key==='loc-locale-v1')return row.text_value||'zh-Hant';
  return row.integer_value??row.text_value??null;
}

// Account navigation reads the three preferences in a single SQL request.
// Other setting consumers can continue using getSetting(key) individually.
export async function getSettings(keys=[]){
  const names=[...new Set((Array.isArray(keys)?keys:[]).map(key=>String(key||'').trim()).filter(Boolean))];
  if(!names.length)return {};
  const {data,error}=await apiRelation('user_settings')
    .select('setting_key,text_value,integer_value,updated_at')
    .in('setting_key',names);
  if(error)throw new Error(error.message||'個人設定讀取失敗');
  const rows=new Map((data||[]).map(row=>[String(row.setting_key),row]));
  return Object.fromEntries(names.map(key=>[key,settingValue(rows.get(key)||null,key)]));
}

export async function getSetting(key){
  // Auth identity was already resolved by the on-demand personal-settings flow;
  // the target relation's RLS limits each reader to their own rows.
  const {data,error}=await apiRelation('user_settings')
    .select('setting_key,text_value,integer_value,updated_at')
    .eq('setting_key',String(key))
    .limit(1);
  if(error)throw new Error(error.message||'個人設定讀取失敗');
  return settingValue(data?.[0]||null,String(key||'').trim());
}

export async function putSetting(key,value){
  await requireUser();
  const row=settingRow(key,value);
  const {data,error}=await apiRelation('user_settings')
    .upsert([row],{onConflict:'owner_id,setting_key'})
    .select('setting_key,text_value,integer_value,updated_at');
  if(error)throw new Error(error.message||'個人設定儲存失敗');
  return settingValue(data?.[0]||row,row.setting_key);
}

export async function deleteSetting(key){
  await requireUser();
  const {error}=await apiRelation('user_settings').delete().eq('setting_key',String(key));
  if(error)throw new Error(error.message||'個人設定刪除失敗');
}

export async function listRuneDrawSlots(){
  const rows=await listRecords('rune-draw-slot',{limit:8});
  const slots=Array.from({length:8},(_,index)=>({slot:index+1,record:null}));
  for(const row of rows){
    const match=String(row.record_kind||'').match(/^slot-([1-8])$/);
    if(match)slots[Number(match[1])-1].record=row;
  }
  return slots;
}

export async function putRuneDrawSlot(slot,record){
  const number=Number(slot);
  if(!Number.isInteger(number)||number<1||number>8)throw new Error('抽牌儲存槽只能是 1–8。');
  const kind=`slot-${number}`;
  const rows=await listRecords('rune-draw-slot',{recordKind:kind,limit:1});
  const current=rows[0]||null;
  return putRecord({
    ...record,
    id:current?.id||randomRecordId('rune-draw-slot'),
    type:'rune-draw-slot',
    record_kind:kind,
    scope_id:'lrunes',
    source:'lrunes-management'
  });
}

export async function putDailyRuneRecord(record){
  const today=dateKey(record?.created_at||new Date());
  if(!today)throw new Error('每日符文紀錄日期無效。');
  const rows=await listRecords('rune-draw',{recordKind:'daily',recordDate:today,limit:2});
  const roles=new Set(rows.map(row=>String(row.daily_role||'').toLowerCase()).filter(Boolean));
  const role=!roles.has('main')?'main':!roles.has('supplement')?'supplement':'';
  if(!role)throw new Error('今天的主符與副符都已儲存；如需調整請到管理頁編輯。');
  return putRecord({
    ...record,
    id:randomRecordId('daily-rune'),
    type:'rune-draw',
    record_kind:'daily',
    record_date:today,
    daily_role:role,
    scope_id:'lrunes',
    source:'lrunes-management'
  });
}
