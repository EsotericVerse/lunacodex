import {parseImportCreatedTime} from './import-batch.mjs';
import {allocateAnchorUid} from './uid.js';

// Importing a known check-in creates its calendar-day Time anchor independently
// from the spatial anchor's full-precision visit timestamps.
const NAME_LIMIT=120;

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
      // A cultural date (moment / attr.date) must never impersonate the
      // article's original creation timestamp.
      const sourceTime=parseImportCreatedTime(record?.createtime??record?.timestamp);
      const millis=sourceTime?Date.parse(sourceTime):NaN;
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
    // Cultural attr.date is the represented day. createtime is the exact
    // source article instant, not that day's midnight.
    const first=items.find(item=>Number.isFinite(item.at)&&item.at<Number.MAX_SAFE_INTEGER);
    return {date,title:titles[0]||date,description,
      createtime:first?new Date(first.at).toISOString():null};
  });
}

export function importCheckinDates(records=[]){
  return importCheckinDayEntries(records).map(item=>item.date);
}

// The Date semantic key is attr.date, not the row's physical uid PK.
// Multiple UIDs for one day remain unresolved instead of selecting one.
export function createImportDateIndex(){
  const existingDays=new Map(),conflictingDays=new Map();
  const accept=row=>{
    if(row?.type!=='date')throw Error('Date Anchor 索引型別不符');
    const day=String(row.attr?.date||'').slice(0,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return;
    if(conflictingDays.has(day)){
      conflictingDays.get(day).add(String(row.uid));
      return;
    }
    const previous=existingDays.get(day);
    if(previous&&String(previous.uid)!==String(row.uid)){
      conflictingDays.set(day,new Set([String(previous.uid),String(row.uid)]));
      existingDays.delete(day);
    }else if(!previous)existingDays.set(day,row);
  };
  return {accept,existingDays,conflictingDays};
}

export async function prepareImportTimeAnchors(records,{
  scopeId,timeTable,relation,pageSize=750,onProgress,anchorSnapshot=null,
}={}){
  const entries=importCheckinDayEntries(records);
  const entryByDate=new Map(entries.map(item=>[item.date,item]));
  const empty={created:0,reused:0,skipped:0,anniversaries:0};
  if(!entryByDate.size||!scopeId||scopeId==='local'||scopeId==='loc')return empty;
  if(!/^[a-z][a-z0-9]{0,14}$/.test(scopeId))throw Error('日期定錨 Scope 無效');
  if(typeof relation!=='function')throw Error('日期定錨資料庫不存在');
  // The registry supplies the logical Time relation, but the physical source
  // of truth for every scoped Date is its unified *_anchor table.
  const logical=String(timeTable||'').trim();
  if(!/^silver\.[a-z][a-z0-9_]*$/.test(logical)||
      !logical.startsWith('silver.'+scopeId+'_'))
    throw Error('日期定錨尚未解析正確的 Scope Time 資料表');
  const table='silver.'+scopeId+'_anchor';
  if(anchorSnapshot&&
      (anchorSnapshot.scopeId!==scopeId||anchorSnapshot.table!==table||
       typeof anchorSnapshot.time?.accept!=='function'))
    throw Error('日期定錨共用索引 Scope 不符');
  const index=anchorSnapshot?.time||createImportDateIndex();
  const {existingDays,conflictingDays}=index;
  if(!anchorSnapshot){
    onProgress?.({phase:'核對既有日期定錨',completed:0,total:0});
    for(let offset=0;;offset+=pageSize){
      const {data,error}=await relation(table).select('uid,type,title,description,attr')
        .eq('type','date').order('title',{ascending:true})
        .order('uid',{ascending:true}).range(offset,offset+pageSize-1);
      if(error)throw Error('讀取日期定錨失敗：'+(error.message||error));
      const rows=data||[];
      for(const row of rows)index.accept(row);
      onProgress?.({phase:'核對既有日期定錨',completed:offset+rows.length,total:0});
      if(rows.length<pageSize)break;
    }
  }
  // Existing Anchor PK constraints and the 23505 retry below protect against
  // improbable secure Base62 UID collisions without preloading all Anchor UIDs.
  const occupied=new Set();
  const dates=[...entryByDate.keys()].sort();
  const missing=dates.filter(day=>!existingDays.has(day)&&!conflictingDays.has(day));
  const conflicts=dates.filter(day=>conflictingDays.has(day)).map(day=>({
    type:'date',date:day,saved_uids:[...conflictingDays.get(day)].sort()
  }));
  let reused=dates.length-missing.length-conflicts.length,created=0,repaired=0;
  for(const day of dates){
    const old=existingDays.get(day),entry=entryByDate.get(day);
    if(!old||old.title!==day||String(old.description||'').trim()||
        !entry||entry.title===day)continue;
    const update=relation(table).update({title:entry.title,description:entry.description})
      .eq('uid',old.uid).eq('type','date').eq('title',day);
    const guarded=old.description==null?update.is('description',null):
      update.eq('description',old.description);
    const {data,error}=await guarded.select('uid');
    if(error)throw Error('補齊日期定錨標題失敗：'+(error.message||error));
    if(!Array.isArray(data)||data.length!==1)
      throw Error('日期定錨已被其他操作修改，請重新載入再補齊');
    repaired++;
    onProgress?.({phase:'補齊舊日期定錨標題',completed:repaired,total:dates.length});
  }
  onProgress?.({phase:'新增缺少的日期定錨',completed:0,total:missing.length});
  for(let offset=0;offset<missing.length;offset+=80){
    const chunk=missing.slice(offset,offset+80);
    let rows,data,error;
    for(let attempt=0;attempt<4;attempt++){
      rows=chunk.map(date=>{
        const uid=allocateAnchorUid(occupied);occupied.add(uid);
        return {uid,type:'date',
        title:entryByDate.get(date).title,
        description:entryByDate.get(date).description,
        ...(entryByDate.get(date).createtime?{createtime:entryByDate.get(date).createtime}:{}),
        attr:{date},invisible:false
      };});
      ({data,error}=await relation(table).insert(rows).select('uid,type,attr'));
      if(error?.code==='23505'&&attempt<3)continue;
      break;
    }
    if(error)throw Error('新增日期定錨失敗：'+(error.message||error));
    const expected=new Map(rows.map(row=>[row.uid,row.attr.date]));
    if(!Array.isArray(data)||data.length!==rows.length||
        data.some(row=>row.type!=='date'||!expected.has(row.uid)||
          row.attr?.date!==expected.get(row.uid)||
          !/^[A-Za-z0-9]{8}$/.test(row.uid))||
        new Set(data.map(row=>row.uid)).size!==rows.length)
      throw Error('新增日期定錨 UID 或日期不符；重新執行將核對已寫入的定錨');
    created+=rows.length;
    onProgress?.({phase:'新增缺少的日期定錨',completed:offset+rows.length,total:missing.length});
  }
  return {created,reused,repaired,skipped:conflicts.length,
    conflicts,anniversaries:0,table};
}
