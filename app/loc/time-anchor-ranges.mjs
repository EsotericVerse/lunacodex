import {allocateAnchorUid} from './uid.js';
// Canonical TimeAnchor graph:
// date.attr.date -> period.attr.uid [startUID, optional endUID]
// -> era.attr.period [period UID, ...].
// A missing endpoint leaves a genuine surviving point; no '0' or now() anchor.
const UID=/^[A-Za-z0-9]{8}$/;
const dateOf=value=>{
  const date=String(value||'').slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date)?date:'';
};
// The persisted Time range is a derived projection, never a replacement for anchor_ids.
export function isTimeUid(value){return UID.test(String(value||''));}
export function allocateTimeUid(rows=[]){
  const occupied=new Set((Array.isArray(rows)?rows:[]).map(row=>String(row?.uid||'')));
  return allocateAnchorUid(occupied);
}
export function encodeTimeSegment(start,end=''){
  const a=String(start||'').trim(),b=String(end||'').trim();
  if(!isTimeUid(a)||b&&!isTimeUid(b)||a===b)
    throw new Error('事件只能引用一個或兩個不同的定錨點 UID');
  return b?[a,b]:[a];
}
export function decodeTimeSegments(value,{legacy=false}={}){
  const ids=Array.isArray(value)?value.map(v=>String(v||'').trim()).filter(Boolean):[];
  if(!ids.length)return [];
  const valid=legacy||ids.every(isTimeUid);
  return [{start:ids[0]||'',end:ids[1]||'',raw:ids.join(','),
    malformed:!valid||ids.length>2||ids[0]===ids[1]}];
}
export function previousTimeDay(value){
  const day=dateOf(value);
  if(!day)return '';
  const date=new Date(day+'T00:00:00Z');date.setUTCDate(date.getUTCDate()-1);
  return date.toISOString().slice(0,10);
}
export function resolveTimeSegments(anchorIds,anchors){
  const known=anchors instanceof Map?anchors:new Map((Array.isArray(anchors)?anchors:[])
    .map(row=>[String(row.uid||''),row]));
  return decodeTimeSegments(anchorIds).map((ids,index)=>{
    const first=known.get(ids.start),last=ids.end?known.get(ids.end):null;
    const a=dateOf(first?.address),b=dateOf(last?.address);
    const missing=[ids.start,...(ids.end?[ids.end]:[])]
      .filter(uid=>!known.has(uid));
    const reversed=Boolean(a&&b&&b<a);
    const point=!a||!b;
    const start=point?a||b:a;
    const end=point?start:b;
    return {index,anchor_ids:[ids.start,...(ids.end?[ids.end]:[])],
      start_anchor_id:ids.start||null,end_anchor_id:ids.end||null,
      start_date:start||null,end_date:end||null,
      invalid:Boolean(ids.malformed||missing.length||reversed),
      point:point||a===b,open_end:false,
      missing_anchor_ids:missing};
  });
}
export function timeSegmentContainsDate(range,day){
  const date=dateOf(day),start=dateOf(range?.start_date),end=dateOf(range?.end_date);
  if(!date||!start||!end)return false;
  // If one referenced anchor was deleted, the remaining point is still real.
  if(range.invalid&&!range.point)return false;
  return date>=start&&date<=end;
}
export function timePeriodContainsDate(period,day){
  return (period?.ranges||[]).some(range=>timeSegmentContainsDate(range,day));
}
export function resolveTimeTrace(periodUids,events){
  const known=events instanceof Map?events:new Map((events||[]).map(event=>[String(event.uid),event]));
  const entries=Array.isArray(periodUids)?periodUids:[];
  const invalidLinks=[],ranges=[];
  for(const [position,raw] of entries.entries()){
    const uid=String(raw||''),event=known.get(uid);
    if(!event||event.type!=='period'){
      invalidLinks.push(uid);
      continue;
    }
    for(const range of event.ranges||[]){
      ranges.push({...range,index:ranges.length,period_uid:uid,segment_order:position});
    }
  }
  return {ranges,invalidLinks};
}
export function timePeriodSortDate(period){
  return (period?.ranges||[]).map(x=>x.start_date).filter(Boolean).sort()[0]||'9999-12-31';
}
export function timePeriodsWithValidRanges(rows=[]){
  return rows.filter(row=>row.ranges?.some(range=>range.start_date&&(!range.invalid||range.point)));
}
// Merge only overlapping or adjoining valid ranges for efficient SQL selection.
// Disconnected ranges remain separate and cannot inherit today's date.
// Intersect every genuine Time interval across multiple sets of periods or
// traces. Inclusive endpoints preserve a legitimate single-anchor point.
// Inputs may be raw Time ranges or previously normalized date windows.
export function intersectTimeDateWindows(windowSets=[]){
  if(!Array.isArray(windowSets)||!windowSets.length)return [];
  const normalized=windowSets.map(set=>timeDateWindows((Array.isArray(set)?set:[]).map(range=>({
    start_date:range.startDate||range.start_date,
    end_date:range.endDate||range.end_date||range.startDate||range.start_date,
    invalid:range.invalid,point:range.point
  }))));
  if(normalized.some(set=>!set.length))return [];
  let shared=normalized[0];
  for(const windows of normalized.slice(1)){
    const overlaps=[];
    let i=0,j=0;
    while(i<shared.length&&j<windows.length){
      const left=shared[i],right=windows[j];
      const startDate=left.startDate>right.startDate?left.startDate:right.startDate;
      const endDate=left.endDate<right.endDate?left.endDate:right.endDate;
      if(startDate<=endDate)overlaps.push({startDate,endDate});
      if(left.endDate<=right.endDate)i++;
      else j++;
    }
    shared=overlaps;
    if(!shared.length)break;
  }
  return shared;
}
export function timeDateWindows(ranges=[]){
  const windows=(Array.isArray(ranges)?ranges:[])
    .filter(range=>range?.start_date&&(!range.invalid||range.point))
    .map(range=>({startDate:dateOf(range.start_date),
      endDate:dateOf(range.end_date)||dateOf(range.start_date)}))
    .filter(range=>range.startDate&&range.endDate&&range.endDate>=range.startDate)
    .sort((a,b)=>a.startDate.localeCompare(b.startDate)||a.endDate.localeCompare(b.endDate));
  const merged=[];
  for(const next of windows){
    const prev=merged.at(-1);
    if(prev&&next.startDate<=prev.endDate){
      if(next.endDate>prev.endDate)prev.endDate=next.endDate;
    }else merged.push({...next});
  }
  return merged;
}
