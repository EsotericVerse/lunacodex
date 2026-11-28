import {
  resolveTimeSegments,resolveTimeTrace,timeDateWindows,timePeriodContainsDate
} from './time-lucus-ranges.mjs';

const list=value=>Array.isArray(value)?value:[];
const text=value=>String(value??'').trim();
const day=value=>text(value).slice(0,10);
function attributes(row){
  if(typeof row?.attr==='string'){
    try{return JSON.parse(row.attr)||{};}catch{return {};}
  }
  return row?.attr&&typeof row.attr==='object'&&!Array.isArray(row.attr)?row.attr:{};
}
function bounds(ranges=[]){
  const values=list(ranges).flatMap(range=>[day(range.start_date),day(range.end_date||range.start_date)])
    .filter(value=>/^\d{4}-\d{2}-\d{2}$/.test(value)).sort();
  return {start_date:values[0]||null,end_date:values.at(-1)||null};
}
function projectScope(scopeId,rows=[]){
  const source=list(rows).filter(row=>['date','period','era'].includes(row?.type));
  const byUid=new Map(source.map(row=>[text(row.uid),row]));
  const dates=source.filter(row=>row.type==='date').map(row=>{
    const date=day(attributes(row).date);
    return {...row,scope_id:scopeId,entry_type:'lucus',
      start_date:date||null,end_date:date||null,
      title:text(row.title)||date||text(row.uid),summary:text(row.description)};
  });
  const periods=source.filter(row=>row.type==='period').map(row=>{
    const attr=attributes(row);
    const lucusIds=list(attr.uid).map(text).filter(Boolean);
    const ranges=resolveTimeSegments(lucusIds,byUid,{period:false});
    return {...row,scope_id:scopeId,entry_type:'period',
      lucus_ids:lucusIds,ranges,...bounds(ranges),
      title:text(row.title)||text(row.uid),summary:text(row.description)};
  });
  const periodMap=new Map(periods.map(row=>[text(row.uid),row]));
  const eras=source.filter(row=>row.type==='era').map(row=>{
    const lucusIds=list(attributes(row).period).map(text).filter(Boolean);
    const resolved=resolveTimeTrace(lucusIds,periodMap);
    const ranges=resolved.ranges;
    return {...row,scope_id:scopeId,entry_type:'era',
      lucus_ids:lucusIds,ranges,...bounds(ranges),
      invalid_lucus_links:resolved.invalidLinks,
      title:text(row.title)||text(row.uid),summary:text(row.description)};
  });
  return [...dates,...periods,...eras];
}

export function projectLocGroupTimeRows(rows=[]){
  const byScope=new Map();
  for(const row of list(rows)){
    const scope=text(row?.scope_id);
    if(!scope)continue;
    if(!byScope.has(scope))byScope.set(scope,[]);
    byScope.get(scope).push(row);
  }
  return [...byScope].flatMap(([scope,records])=>projectScope(scope,records));
}

export function buildLocEraIndex(rows=[]){
  return projectLocGroupTimeRows(rows)
    .filter(row=>row.entry_type==='era'&&row.ranges.some(range=>range.start_date))
    .map(row=>({...row,key:row.scope_id+':'+row.uid}))
    .sort((a,b)=>String(b.end_date||'').localeCompare(String(a.end_date||''))||
      String(b.start_date||'').localeCompare(String(a.start_date||''))||
      a.scope_id.localeCompare(b.scope_id)||String(a.uid).localeCompare(String(b.uid)));
}

export function locEraWindows(era){
  return timeDateWindows(list(era?.ranges));
}

function clipRanges(ranges,windows){
  const output=[];
  for(const range of list(ranges)){
    if(!range?.start_date||range.invalid&&!range.point)continue;
    const start=day(range.start_date),end=day(range.end_date||range.start_date);
    if(!start||!end||end<start)continue;
    for(const window of windows){
      const from=start>window.startDate?start:window.startDate;
      const until=end<window.endDate?end:window.endDate;
      if(from<=until)output.push({...range,start_date:from,end_date:until});
    }
  }
  return output;
}

export function buildLocEraRiver(rows=[],eraKey='',windows=[]){
  const normalized=projectLocGroupTimeRows(rows);
  const era=normalized.find(row=>row.entry_type==='era'&&
    row.scope_id+':'+row.uid===String(eraKey||''));
  if(!era)return {items:[],groups:[],era:null};
  const scope=era.scope_id,eraUid=text(era.uid);
  const eraGroup='loc-era:'+scope+':'+eraUid;
  const validWindows=list(windows).filter(window=>
    window?.startDate&&window?.endDate&&window.startDate<=window.endDate);
  if(!validWindows.length)return {items:[],groups:[],era};
  const periodIds=new Set(era.lucus_ids.map(text));
  const periods=normalized.filter(row=>row.scope_id===scope&&
    row.entry_type==='period'&&periodIds.has(text(row.uid)));
  const dates=normalized.filter(row=>row.entry_type==='lucus'&&
    validWindows.some(window=>row.start_date>=window.startDate&&row.start_date<=window.endDate));
  const selectedScopeDates=dates.filter(row=>row.scope_id===scope);
  const otherScopeDates=dates.filter(row=>row.scope_id!==scope);
  const groups=[{id:eraGroup,label:era.title,order:0,
    className:'scope-culture-layer-era'}],items=[];
  const eraRanges=clipRanges(era.ranges,validWindows);
  for(const [index,range] of eraRanges.entries())items.push({
    id:eraGroup+':segment:'+index,entry_type:'era',uid:eraUid,
    scope_id:scope,group_key:eraGroup,group_label:era.title,group_order:0,
    title:era.title,display_label:'',start_date:range.start_date,
    ...(range.end_date>range.start_date?{end_date:range.end_date}:{})
  });
  const assigned=new Set();
  for(const [position,period] of periods.entries()){
    const periodUid=text(period.uid),periodGroup='loc-period:'+scope+':'+eraUid+':'+periodUid;
    const ranges=clipRanges(period.ranges,validWindows);
    if(!ranges.length)continue;
    groups.push({id:periodGroup,label:period.title||'期間',order:position+1,
      className:'scope-culture-layer-period'});
    for(const [index,range] of ranges.entries())items.push({
      id:periodGroup+':segment:'+index,entry_type:'period',uid:periodUid,
      scope_id:scope,group_key:periodGroup,group_label:period.title||'期間',
      group_order:position+1,title:period.title||'期間',display_label:'',
      start_date:range.start_date,
      ...(range.end_date>range.start_date?{end_date:range.end_date}:{})
    });
    for(const point of selectedScopeDates){
      if(!timePeriodContainsDate(period,point.start_date))continue;
      assigned.add(text(point.uid));
      items.push({id:periodGroup+':'+point.uid,entry_type:'lucus',uid:text(point.uid),
        scope_id:scope,group_key:periodGroup,group_label:period.title||'期間',
        group_order:position+1,title:point.title||point.start_date,display_label:'◆',
        start_date:point.start_date,class_name:'scope-time-original-lucus'});
    }
  }
  const unassigned=selectedScopeDates.filter(point=>!assigned.has(text(point.uid)));
  if(unassigned.length){
    const group='loc-era-unassigned:'+scope+':'+eraUid;
    groups.push({id:group,label:'未歸屬定錨點',order:groups.length,
      className:'scope-culture-layer-period'});
    for(const point of unassigned)items.push({
      id:group+':'+point.uid,entry_type:'lucus',uid:text(point.uid),scope_id:scope,
      group_key:group,group_label:'未歸屬定錨點',group_order:groups.length-1,
      title:point.title||point.start_date,display_label:'◆',
      start_date:point.start_date,class_name:'scope-time-original-lucus'
    });
  }
  const otherByScope=new Map();
  for(const point of otherScopeDates){
    if(!otherByScope.has(point.scope_id))otherByScope.set(point.scope_id,[]);
    otherByScope.get(point.scope_id).push(point);
  }
  for(const [otherScope,points] of [...otherByScope].sort(([a],[b])=>a.localeCompare(b))){
    const group='loc-scope-lucus:'+otherScope;
    const order=groups.length;
    groups.push({id:group,label:otherScope+' · 時間定錨',order,
      className:'scope-culture-layer-period'});
    for(const point of points)items.push({
      id:group+':'+point.uid,entry_type:'lucus',uid:text(point.uid),
      scope_id:otherScope,group_key:group,group_label:otherScope+' · 時間定錨',
      group_order:order,title:point.title||point.start_date,
      display_label:'◆',start_date:point.start_date,
      class_name:'scope-time-original-lucus'
    });
  }
  return {items,groups,era};
}

export function mergeLocCultureDensityRows(rows=[]){
  const totals=new Map();
  for(const row of list(rows)){
    const dayKey=day(row?.day),site=text(row?.site);
    const count=Math.max(0,Number(row?.item_count)||0);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)||!site||!count)continue;
    const key=JSON.stringify([dayKey,site]);
    const current=totals.get(key)||{day:dayKey,site,item_count:0};
    current.item_count+=count;
    totals.set(key,current);
  }
  return [...totals.values()].sort((a,b)=>a.day.localeCompare(b.day)||a.site.localeCompare(b.site));
}
