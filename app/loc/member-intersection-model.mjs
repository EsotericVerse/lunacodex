const ISO_DATE=/^\d{4}-\d{2}-\d{2}$/;
const time=value=>new Date(value+'T00:00:00Z');
const number=value=>Math.max(0,Number(value)||0);
const lower=value=>String(value||'').trim().toLowerCase();
// Admin's alias mapping decides the group; anything unmapped is Others. The raw
// source names inside Others are counted live from the data, never stored.
export function assignedSource(value,aliases=[],categories=[]){
  const mapping=aliases.find(row=>lower(row.source_key)===lower(value));
  const category=lower(mapping?.category_code||'others');
  return categories.some(row=>row.category_code===category&&row.enabled!==false)?category:'others';
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
    {id:'daily',name:'每日符文'},
    {id:'daily:kind:main',name:'每日符文 · 主抽'},
    {id:'daily:kind:supplement',name:'每日符文 · 補抽'},
    ...['正位','半正位','半逆位','逆位'].map(direction=>({id:'daily:direction:'+direction,name:'每日符文 · '+direction})),
    ...['新月','上弦','滿月','下弦','空亡'].map(phase=>({id:'daily:phase:'+phase,name:'每日符文 · '+phase}))
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
    values:lane.metric.startsWith('daily')
      ?new Map()
      :measureRows(datasets.get(lane.person)?.rows||[],lane.metric,categories,aliases)
  }));
  for(const lane of selected)if(lane.metric.startsWith('daily')){
    if(lane.person!=='lrunes')continue;
    for(const row of datasets.get(lane.person)?.daily||[]){
      const day=String(row.record_date||'').slice(0,10),metric=lane.metric;
      const match=metric==='daily'
        ||(metric.startsWith('daily:kind:')&&String(row.draw_kind||'')===metric.slice(11))
        ||(metric.startsWith('daily:direction:')&&String(row.direction||'')===metric.slice(16))
        ||(metric.startsWith('daily:phase:')&&String(row.phase||row.recorded_phase||'')===metric.slice(12));
      if(ISO_DATE.test(day)&&match)lane.values.set(day,(lane.values.get(day)||0)+1);
    }
  }
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
