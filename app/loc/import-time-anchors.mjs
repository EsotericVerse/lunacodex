import {parseImportCreatedTime} from './import-batch.mjs';
import {readUnifiedAnchorUids} from './unified-anchor-uids.mjs';

// Importing a known check-in creates its calendar-day Time anchor independently
// from the spatial anchor's full-precision visit timestamps.
const NAME_LIMIT=120;
const HEX=/^[0-9A-F]{4}$/;

const DESCRIPTION_LIMIT=4000;
const placeLabel=record=>String(record?.__importPlaceName||record?.location||'').trim();
const visibleLabel=value=>String(value||'').replace(/[\u0000-\u001f]/g,' ')
  .replace(/\s+/g,' ').trim().slice(0,NAME_LIMIT);
// A single formatter serves every date in large ZIP and social-archive imports.
const importDayFormatter=new Intl.DateTimeFormat('sv-SE',{
  timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'
});
const calendarDay=value=>{
  const literal=String(value||'').trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(literal))return literal;
  const instant=parseImportCreatedTime(value);
  return instant?importDayFormatter.format(new Date(instant)):'';
};

// One calendar date is one Time anchor. The first dated article title names
// that day; a date-only source check-in can use its place name instead.
export function importCheckinDayEntries(records=[]){
  const grouped=new Map();
  for(const [index,record] of (records||[]).entries()){
    const place=placeLabel(record);
    if(!place||place.length>NAME_LIMIT)continue;
    const articleTitle=visibleLabel(record?.title);
    const fallback=visibleLabel(place);
    const visits=Array.isArray(record?.__importVisitTimes)
      ?record.__importVisitTimes.filter(Boolean):[];
    const moments=visits.length?visits:
      [record?.date||record?.createtime||record?.timestamp];
    for(const moment of moments){
      const day=calendarDay(moment);
      if(!day)continue;
      if(!grouped.has(day))grouped.set(day,[]);
      const millis=Date.parse(String(record?.createtime||moment||''));
      grouped.get(day).push({title:articleTitle||fallback,
        article:Boolean(articleTitle),position:index,
        at:Number.isFinite(millis)?millis:Number.MAX_SAFE_INTEGER});
    }
  }
  return [...grouped].sort(([a],[b])=>a.localeCompare(b)).map(([date,items])=>{
    items.sort((a,b)=>Number(b.article)-Number(a.article)||a.at-b.at||a.position-b.position);
    const titles=[...new Set(items.map(item=>item.title).filter(Boolean))];
    const articleTitles=[...new Set(items.filter(item=>item.article).map(item=>item.title))];
    const headlines=articleTitles.length?articleTitles:titles;
    const prefix='重要大事：';
    let description=prefix;
    for(const headline of headlines){
      const addition=(description===prefix?'':'｜')+headline;
      if(description.length+addition.length>DESCRIPTION_LIMIT)break;
      description+=addition;
    }
    return {date,title:titles[0]||date,description};
  });
}

export function importCheckinDates(records=[]){
  return importCheckinDayEntries(records).map(item=>item.date);
}

export async function prepareImportTimeAnchors(records,{
  scopeId,timeTable,relation,pageSize=750,onProgress,
  includeUnifiedUidPool=false
}={}){
  const entries=importCheckinDayEntries(records);
  const checkinDates=entries.map(item=>item.date);
  const entryByDate=new Map(entries.map(item=>[item.date,item]));
  const empty={created:0,reused:0,skipped:0,anniversaries:0};
  if(!checkinDates.length||!scopeId||
      scopeId==='local'||scopeId==='loc')return empty;
  if(!/^[a-z][a-z0-9]{0,14}$/.test(scopeId))throw Error('日期定錨 Scope 無效');
  if(typeof relation!=='function')throw Error('日期定錨資料庫不存在');
  // The scope registry owns the physical Time relation; never guess its suffix.
  const table=String(timeTable||'').trim();
  if(!/^silver\.[a-z][a-z0-9_]*$/.test(table)||!table.startsWith('silver.'+scopeId+'_'))
    throw Error('日期定錨尚未解析正確的 Scope Time 資料表');
  const occupied=new Set(),existingDays=new Map();
  onProgress?.({phase:'核對既有日期定錨',completed:0,total:0});
  for(let offset=0;;offset+=pageSize){
    const {data,error}=await relation(table).select('uid,type,title,description,address')
      .order('uid',{ascending:true}).range(offset,offset+pageSize-1);
    if(error)throw Error('讀取日期定錨失敗：'+(error.message||error));
    const rows=data||[];
    for(const row of rows){
      occupied.add(String(row.uid||''));
      if(row.type==='anchor'&&row.address){
        existingDays.set(String(row.address).slice(0,10),row);
      }
    }
    onProgress?.({phase:'核對既有日期定錨',completed:offset+rows.length,total:0});
    if(rows.length<pageSize)break;
  }
  if(includeUnifiedUidPool){
    const shared=await readUnifiedAnchorUids(table,async(anchor,offset,limit)=>{
      const {data,error}=await relation(anchor).select('uid')
        .order('uid',{ascending:true}).range(offset,offset+limit-1);
      if(error)throw Error('核對統一定錨 UID 失敗：'+(error.message||error));
      return data||[];
    });
    for(const row of shared)occupied.add(row.uid);
  }
  // Period membership never counts as an existing calendar-day anchor.
  const dates=[...entryByDate.keys()].sort();
  const missing=dates.filter(date=>!existingDays.has(date));
  let reused=dates.length-missing.length,created=0,repaired=0,cursor=1;
  // Only repair the old machine-generated placeholders on explicit re-import
  // or reconciliation; preserve every human-written title or description.
  for(const day of checkinDates){
    const old=existingDays.get(day),entry=entryByDate.get(day);
    if(!old||old.title!==day||String(old.description||'').trim()||!entry||entry.title===day)
      continue;
    const update=relation(table).update({title:entry.title,description:entry.description})
      .eq('uid',old.uid).eq('type','anchor').eq('address',day).eq('title',day);
    const expected=old.description==null?update.is('description',null)
      :update.eq('description',old.description);
    const {data,error}=await expected.select('uid');
    if(error)throw Error('補齊日期定錨標題失敗：'+(error.message||error));
    if(!Array.isArray(data)||data.length!==1)
      throw Error('日期定錨已被其他操作修改，請重新載入再補齊');
    repaired++;
    onProgress?.({phase:'補齊舊日期定錨標題',completed:repaired,total:dates.length});
  }
  const nextUid=()=>{
    if(scopeId==='lo3rwang'){
      const alphabet='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
      const random=globalThis.crypto?.getRandomValues?.bind(globalThis.crypto);
      if(!random)throw Error('Secure Anchor UID generator unavailable');
      for(let attempt=0;attempt<128;attempt++){
        let uid='';
        for(const byte of random(new Uint8Array(16))){
          if(byte>=248)continue;
          uid+=alphabet[byte%62];
          if(uid.length===8)break;
        }
        if(uid.length===8&&!occupied.has(uid)){occupied.add(uid);return uid;}
      }
      throw Error('Unable to allocate an eight-character Time Anchor UID');
    }
    while(cursor<=65535){
      const uid=cursor.toString(16).toUpperCase().padStart(4,'0');
      cursor++;
      if(HEX.test(uid)&&!occupied.has(uid)){occupied.add(uid);return uid;}
    }
    throw Error('四碼日期定錨 UID 已用盡');
  };
  for(let offset=0;offset<missing.length;offset+=80){
    const chunk=missing.slice(offset,offset+80);
    const rows=chunk.map(date=>({
      uid:nextUid(),type:'anchor',title:entryByDate.get(date).title,
      description:entryByDate.get(date).description,
      address:date,anchor_ids:[],invisible:false
    }));
    const {data,error}=await relation(table).insert(rows).select('uid,address');
    if(error)throw Error('新增日期定錨失敗：'+(error.message||error));
    if(!Array.isArray(data)||data.length!==rows.length)
      throw Error('新增日期定錨回傳筆數不符');
    created+=rows.length;
    onProgress?.({phase:'新增缺少的日期定錨',completed:offset+rows.length,total:missing.length});
  }
  return {created,reused,repaired,skipped:0,anniversaries:0,table};
}
