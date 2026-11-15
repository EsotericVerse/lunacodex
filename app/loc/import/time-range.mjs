// A single UTC cutoff is shared by the preview, comparison pool and writes.
// A limited window excludes undated records rather than silently importing them.
const RANGE_MONTHS=Object.freeze({month:1,halfYear:6,year:12});

export function importTimeRangeWindow(range='year',now=new Date()){
  if(range==='all')return null;
  const months=RANGE_MONTHS[range];
  if(!months)throw Error('不支援的匯入時間區間：'+range);
  const end=new Date(now);
  if(!Number.isFinite(end.getTime()))throw Error('匯入時間基準無效');
  const start=new Date(end);
  const day=start.getUTCDate();
  start.setUTCDate(1);
  start.setUTCMonth(start.getUTCMonth()-months);
  const lastDay=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+1,0)).getUTCDate();
  start.setUTCDate(Math.min(day,lastDay));
  return {start:start.toISOString(),end:end.toISOString()};
}

export function importWithinTimeRange(row,window){
  if(!window)return true;
  const timestamp=Date.parse(String(row?.createtime??''));
  return Number.isFinite(timestamp)&&timestamp>=Date.parse(window.start)&&
    timestamp<=Date.parse(window.end);
}

export function filterImportAnalysisByTime(analysis,window){
  if(!window)return {...analysis,skippedByRange:0,undatedByRange:0};
  const normalized=analysis.normalized.filter(item=>importWithinTimeRange(item.record,window));
  const valid=normalized.map(item=>item.record);
  const eligibleUids=new Set(valid.map(row=>String(row.uid)));
  // Never detach a media-only record from a parent post excluded by the window.
  const mediaOnly=analysis.mediaOnly.filter(row=>importWithinTimeRange(row,window)&&
    (!row.__article_uid||eligibleUids.has(String(row.__article_uid))));
  const keptMedia=new Set(mediaOnly);
  const excluded=[...analysis.valid.filter(row=>!importWithinTimeRange(row,window)),
    ...analysis.mediaOnly.filter(row=>!keptMedia.has(row))];
  return {
    ...analysis,valid,normalized,mediaOnly,
    skippedByRange:excluded.length,
    undatedByRange:excluded.filter(row=>!Number.isFinite(Date.parse(String(row?.createtime??'')))).length
  };
}
