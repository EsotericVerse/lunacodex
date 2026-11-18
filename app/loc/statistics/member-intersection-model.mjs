const ISO_DATE=/^\d{4}-\d{2}-\d{2}$/;
const time=value=>new Date(value+'T00:00:00Z');
const number=value=>Math.max(0,Number(value)||0);
const lower=value=>String(value||'').trim().toLowerCase();
// Admin's alias mapping decides the group; anything unmapped is Others. The raw
// source names inside Others are counted live from the data, never stored.
export function assignedSource(value,aliases=[],categories=[]){
  const mapping=aliases.find(row=>lower(row.source_key)===lower(value));
  // Preserve the existing eight-character Source Anchor UID exactly.
  // A category code is a ZModel identity, not a lowercased display label.
  const category=lower(mapping?.category_code||'others');
  const found=categories.find(row=>lower(row.category_code)===category&&row.enabled!==false);
  return found?.category_code||'others';
}
export function availableMemberMeasures(datasets=[],categories=[]){
  const media=new Set();
  for(const rows of datasets)for(const row of rows||[]){
    if(row.kind==='media'&&row.category)media.add(lower(row.category));
  }
  return [
    {id:'total',name:'全部作品'},
    {id:'text',name:'文字作品'},
    {id:'multimedia',name:'多媒體'},
    ...categories.filter(x=>x.enabled!==false).map(row=>({id:'source:'+row.category_code,name:'作品分類 · '+row.display_name})),
    ...[...media].sort().map(id=>({id:'media:'+id,name:'多媒體類型 · '+id})),
  ];
}
function measureRows(rows=[],metric,categories,aliases){
  const counts=new Map();
  for(const row of rows||[]){
    const day=String(row.day||'').slice(0,10);
    if(!ISO_DATE.test(day))continue;
    const count=number(row.item_count);
    if(!count)continue;
    let include=false;
    if(metric==='total')include=row.kind==='total';
    else if(metric==='text')include=row.kind==='total'&&row.category==='文字作品';
    else if(metric==='multimedia')include=row.kind==='total'&&row.category==='多媒體';
    else if(metric.startsWith('source:'))include=row.kind==='source'&&assignedSource(row.category,aliases,categories)===metric.slice(7);
    else if(metric.startsWith('media:'))include=row.kind==='media'&&lower(row.category)===metric.slice(6);
    if(include)counts.set(day,(counts.get(day)||0)+count);
  }
  return counts;
}
function bucket(day,unit){
  if(unit==='month')return day.slice(0,7);
  if(unit==='week'){
    const d=time(day);d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));
    return d.toISOString().slice(0,10);
  }
  return day;
}
export function calculateMemberCross(lanes=[],datasets=new Map(),{
  from='',to='',unit='week',categories=[],aliases=[]
}={}){
  if(!ISO_DATE.test(from)||!ISO_DATE.test(to)||from>to)return {rows:[],series:[],totals:[],commonDays:0,unionDays:0,daysPerLane:[]};
  const selected=lanes.slice(0,4).map((lane,i)=>({
    ...lane,key:'line'+i,
    values:measureRows(datasets.get(lane.person)?.rows||[],lane.metric,categories,aliases)
  }));
  const rows=new Map(),daysPerLane=selected.map(()=>0);
  let commonDays=0,unionDays=0;
  for(let d=time(from),end=time(to);d<=end;d.setUTCDate(d.getUTCDate()+1)){
    const day=d.toISOString().slice(0,10),id=bucket(day,unit);
    if(!rows.has(id))rows.set(id,{period:id,start_date:day,end_date:day,...Object.fromEntries(selected.map(x=>[x.key,0]))});
    const point=rows.get(id);point.end_date=day;
    let active=0;
    selected.forEach((lane,i)=>{
      const n=lane.values.get(day)||0;point[lane.key]+=n;
      if(n>0){active++;daysPerLane[i]++;}
    });
    if(active)unionDays++;
    if(active===selected.length&&selected.length>1)commonDays++;
  }
  const totals=selected.map((lane,i)=>({
    name:lane.label||lane.person,
    value:[...rows.values()].reduce((sum,row)=>sum+number(row[lane.key]),0),
    id:lane.person,activeDays:daysPerLane[i]
  }));
  return {rows:[...rows.values()],series:selected.map(x=>({key:x.key,label:x.label||x.person})),totals,commonDays,unionDays,daysPerLane};
}
