// Shared "favorite-frame" filters for a selected Trace place. These filters
// never change stored anchors, visit timestamps, or the current route.
const dateISO=date=>date.toISOString().slice(0,10);
export const TRACE_PANEL_MODES=Object.freeze(['articles','timeline','statistics']);
export const TRACE_TIME_WINDOWS=Object.freeze(['3m','12m','all','custom']);
export function traceWindow(window='3m',now=new Date(),custom={}){
  const today=new Date(now);
  // Use Taiwan's civil date, not the browser's locale-dependent date.
  const tw=new Date(today.getTime()+8*3600000);
  const end=dateISO(tw);
  if(window==='all')return {startDate:'',endDate:''};
  if(window==='custom'){
    const startDate=String(custom.start||''),endDate=String(custom.end||'');
    return {startDate:/^\d{4}-\d{2}-\d{2}$/.test(startDate)?startDate:'',
      endDate:/^\d{4}-\d{2}-\d{2}$/.test(endDate)?endDate:''};
  }
  const begin=new Date(end+'T00:00:00Z');
  const day=begin.getUTCDate();
  begin.setUTCDate(1);
  begin.setUTCMonth(begin.getUTCMonth()-(window==='12m'?12:3));
  begin.setUTCDate(Math.min(day,new Date(Date.UTC(begin.getUTCFullYear(),
    begin.getUTCMonth()+1,0)).getUTCDate()));
  return {startDate:dateISO(begin),endDate:end};
}
export function traceArticleFilters(places,{startDate='',endDate='',sourceName=''}={}){
  const names=Array.isArray(places)?places.map(x=>String(x||'').trim()).filter(Boolean):[];
  if(!names.length)return [];
  return [
    {column:'location',operator:names.length===1?'eq':'in',
      value:names.length===1?names[0]:names},
    {column:'trace',operator:'eq',value:'true'},
    ...(sourceName.trim()?[{column:'site',operator:'ilike',value:sourceName.trim()}]:[]),
    ...(startDate?[{column:'date',operator:'gte',value:startDate}]:[]),
    ...(endDate?[{column:'date',operator:'lte',value:endDate}]:[])
  ];
}
export function groupedTraceDays(rows=[],{key='location'}={}){
  const group=new Map();
  for(const row of rows){
    const day=String(row.date||row.createtime||'').slice(0,10);
    const category=String(row[key]||'').trim();
    if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!category)continue;
    const groupKey=day+'|'+category;
    group.set(groupKey,(group.get(groupKey)||0)+1);
  }
  return [...group].map(([key,item_count])=>{
    const sep=key.indexOf('|');
    return {day:key.slice(0,sep),category:key.slice(sep+1),item_count};
  });
}

export const TRACE_MEDIA_TYPES=Object.freeze(['音樂','圖片','影片','rune']);
export function traceMediaMatches(articles=[],media=[]){
  const matchingIds=new Set(media.map(row=>String(row.uid||'').trim()).filter(Boolean));
  return articles.filter(row=>Array.isArray(row.media_link)&&row.media_link.some(id=>matchingIds.has(String(id))));
}

/** The physical place UID may be four (legacy) or eight characters; preserve case. */
export function traceArticleIdFilters(placeIds,{startDate='',endDate='',sourceName='',allPlacedArticles=false}={}){
  const ids=[...new Set((Array.isArray(placeIds)?placeIds:[])
    .map(id=>String(id||'').trim())
    .filter(id=>/^(?:[A-Za-z0-9]{4}|[A-Za-z0-9]{8})$/.test(id)))];
  if(!ids.length)return [{column:'place_id',operator:'eq',value:'__NO_PLACE_ID__'}];
  return [
    {column:'place_id',operator:ids.length===1?'eq':'in',value:ids.length===1?ids[0]:ids},
    ...(!allPlacedArticles?[{column:'trace',operator:'eq',value:'true'}]:[]),
    ...(sourceName.trim()?[{column:'site',operator:'ilike',value:sourceName.trim()}]:[]),
    ...(startDate?[{column:'date',operator:'gte',value:startDate}]:[]),
    ...(endDate?[{column:'date',operator:'lte',value:endDate}]:[])
  ];
}
