// One plain model for ISR place counts used by Culture and Statistics.
// Galaxy.location is a text check-in, not an inferred visit or mandatory
// trace anchor. Keep names verbatim; do not invent a classification hierarchy.
const dateKey=value=>/^\d{4}-\d{2}-\d{2}$/.test(String(value||'').slice(0,10))
  ?String(value).slice(0,10):'';
const safeCount=value=>Math.max(0,Number(value)||0);
const dayAfter=value=>{
  const d=new Date(value+'T00:00:00Z');
  d.setUTCDate(d.getUTCDate()+1);
  return d.toISOString().slice(0,10);
};
export function summarizePlaceStatistics(payload={},{bucket='month',limit=12}={}){
  const rows=Array.isArray(payload?.rows)?payload.rows:[];
  const anchors=Array.isArray(payload?.anchors)?payload.anchors:[];
  const savedNames=new Set(anchors.map(row=>String(row?.title||'').trim()).filter(Boolean));
  const places=new Map(),buckets=new Map();
  for(const row of rows){
    const day=dateKey(row?.day),name=String(row?.category||'').trim();
    const amount=safeCount(row?.item_count);
    if(!day||!name||!amount)continue;
    places.set(name,(places.get(name)||0)+amount);
    const key=bucket==='day'?day:bucket==='year'?day.slice(0,4):bucket==='week'
      ?(()=>{const monday=new Date(day+'T00:00:00Z');const weekday=monday.getUTCDay();
        monday.setUTCDate(monday.getUTCDate()-(weekday===0?6:weekday-1));
        return monday.toISOString().slice(0,10);})()
      :day.slice(0,7);
    if(!buckets.has(key))buckets.set(key,new Map());
    const entry=buckets.get(key);
    entry.set(name,(entry.get(name)||0)+amount);
  }
  const allPlaces=[...places].map(([name,count])=>({name,count,anchored:savedNames.has(name)}))
    .sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,'zh-Hant'));
  const names=allPlaces.slice(0,Math.max(1,Math.floor(Number(limit)||12))).map(place=>place.name);
  const nameSet=new Set(names);
  const rest=allPlaces.length>names.length;
  const fields=[...names,...(rest?['其他地點']:[])];
  const series=fields.map((label,index)=>({key:'place_'+index,label}));
  const trend=[...buckets].sort(([a],[b])=>a.localeCompare(b)).map(([key,counts])=>{
    const output={period:key.replace('-','/'),start_date:key};
    let remainder=0;
    names.forEach((name,index)=>{output['place_'+index]=counts.get(name)||0;});
    for(const [name,n] of counts)if(!nameSet.has(name))remainder+=n;
    if(rest)output['place_'+names.length]=remainder;
    return output;
  });
  const distribution=[...allPlaces.slice(0,Math.max(1,Math.floor(Number(limit)||12)))
    .map(place=>({name:place.name,value:place.count})),
    ...(rest?[{name:'其他地點',value:allPlaces.slice(names.length).reduce((n,p)=>n+p.count,0)}]:[])];
  return {places:allPlaces,total:allPlaces.reduce((n,p)=>n+p.count,0),
    anchorsCount:anchors.length,series,trend,distribution};
}
export function placeRiverModel(payload={},selection='',limit=12){
  const summary=summarizePlaceStatistics(payload,{bucket:'day',limit});
  const allowed=selection?summary.places.filter(p=>p.name===selection):summary.places.slice(0,limit);
  const visible=new Set(allowed.map(p=>p.name));
  const totals=new Map(allowed.map(p=>[p.name,p.count]));
  const groups=allowed.map((place,index)=>({
    id:'place:'+index,label:place.name+'（'+place.count.toLocaleString('zh-TW')+'）',
    order:index,selectable:false
  }));
  const ids=new Map(allowed.map((place,index)=>[place.name,'place:'+index]));
  const items=(Array.isArray(payload?.rows)?payload.rows:[])
    .filter(row=>visible.has(String(row?.category||'').trim())
      &&dateKey(row?.day)&&safeCount(row?.item_count)>0)
    .map((row,index)=>{
      const day=dateKey(row.day),name=String(row.category).trim(),count=safeCount(row.item_count);
      return {
        id:'trace-place:'+index+':'+day,entry_id:'trace-place:'+index+':'+day,
        entry_type:'place_density',group_key:ids.get(name),group_label:name,
        group_order:allowed.findIndex(place=>place.name===name),
        start_date:day,end_date:dayAfter(day),
        item_count:count,density_ratio:count/Math.max(1,totals.get(name)||1),
        display_label:'',title:day+' · '+name+' · '+count.toLocaleString('zh-TW')+' 篇'
      };
    });
  return {items,groups,places:summary.places,total:summary.total,
    anchorsCount:summary.anchorsCount};
}
