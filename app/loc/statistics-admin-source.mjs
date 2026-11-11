import {assignedSource} from './member-intersection-model.mjs';

const day=value=>String(value||'').slice(0,10);
function bucket(d,unit){
  if(unit==='month')return d.slice(0,7);
  if(unit==='week'){
    const v=new Date(d+'T00:00:00Z');
    v.setUTCDate(v.getUTCDate()-((v.getUTCDay()+6)%7));
    return v.toISOString().slice(0,10);
  }
  return d;
}
export function administrativeSourceTrend(raw=[],taxonomy={},{startDate='',endDate='',unit='day',sourceCategory='',sourceNames=null}={}){
  const start=day(startDate),end=day(endDate);
  const selectedSource=String(sourceCategory||'').trim();
  // A Domain selector includes the From leaves linked by Anchor attr.uid.
  // No extra SQL/COUNT query is required for an expanded Source selection.
  const selectedCodes=new Set([selectedSource,...(taxonomy.tree||[])
    .filter(row=>Array.isArray(row.path)&&row.path.includes(selectedSource))
    .map(row=>row.uid)]);
  const allowedNames=Array.isArray(sourceNames)?new Set(sourceNames.map(v=>String(v||'').trim().toLowerCase())):null;
  const categories=(taxonomy.categories||[]).filter(c=>c.enabled!==false);
  const aliases=taxonomy.aliases||[];
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)||start>end){
    return {rows:[],series:[],distribution:[],total:0};
  }
  const keys=new Map(categories.map(c=>[c.category_code,c.display_name]));
  if(!keys.has('others'))keys.set('others','未分類');
  const data=new Map(),totals=new Map(),rawRecords=Array.isArray(raw)?raw:[];
  for(let date=new Date(start+'T00:00:00Z'),last=new Date(end+'T00:00:00Z');date<=last;date.setUTCDate(date.getUTCDate()+1)){
    const today=date.toISOString().slice(0,10),group=bucket(today,unit);
    if(!data.has(group))data.set(group,{period:group,start_date:today,end_date:today,total:0});
    data.get(group).end_date=today;
  }
  for(const record of rawRecords){
    const date=day(record.day),count=Math.max(0,Number(record.item_count)||0);
    if(date<start||date>end||!count)continue;
    const group=bucket(date,unit),item=data.get(group);
    if(!item)continue;
    // Total rows include multimedia, so only use them for the unfiltered view.
    // A chosen source is defined by the matching text source rows alone.
    if(record.kind==='total'&&!selectedSource)item.total+=count;
    if(record.kind!=='source')continue;
    const category=assignedSource(record.category,aliases,categories);
    if(selectedSource&&!selectedCodes.has(category))continue;
    if(allowedNames&&!allowedNames.has(String(record.category||'').trim().toLowerCase()))continue;
    if(selectedSource)item.total+=count;
    const key='category_'+category;
    item[key]=(item[key]||0)+count;
    totals.set(category,(totals.get(category)||0)+count);
  }
  const present=[...keys].filter(([id])=>totals.get(id)>0);
  const series=present.map(([id,label])=>({key:'category_'+id,label}));
  const distribution=present.map(([id,label])=>({name:label,value:totals.get(id)}));
  const rows=[...data.values()].map(point=>({
    ...point,...Object.fromEntries(series.map(s=>[s.key,Number(point[s.key])||0]))
  }));
  return {rows,series,distribution,total:rows.reduce((n,row)=>n+row.total,0)};
}
