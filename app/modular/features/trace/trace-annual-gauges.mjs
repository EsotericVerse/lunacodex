// Annual article presence for an existing set of visible Trace anchor UIDs.
// Ratio = distinct article days in the requested year / calendar days in that year.
// This is not a visit count, a percentage of all articles, or a location forecast.
export const ANNUAL_GAUGE_SCOPE_LIMIT=80;
const uid=value=>String(value||'').trim();
const placeMembers=point=>Array.isArray(point?.members)&&point.members.length?point.members:[point];
const allowedUid=value=>/^(?:[A-Za-z0-9]{4}|[A-Za-z0-9]{8})$/.test(value);

export function annualGaugeGroups(points=[],allowedScopes=[],limit=ANNUAL_GAUGE_SCOPE_LIMIT){
  const byScope=new Map();
  const allowed=new Set(allowedScopes);
  for(const point of Array.isArray(points)?points:[]){
    for(const member of placeMembers(point)){
      const scope=String(member?.source_scope||''),id=uid(member?.uid);
      if(!allowed.has(scope)||scope==='loc'||!allowedUid(id))continue;
      if(!byScope.has(scope))byScope.set(scope,new Set());
      const ids=byScope.get(scope);
      if(ids.size<limit)ids.add(id);
    }
  }
  return [...byScope].map(([scope,ids])=>({scope,ids:[...ids]}));
}

export function annualGaugeValues(points=[],groups=[],rows=[],startDate='',endDate=''){
  const start=Date.parse(startDate+'T00:00:00Z');
  const end=Date.parse(endDate+'T00:00:00Z');
  const span=Math.round((end-start)/86400000)+1;
  if(!Number.isFinite(span)||span<=0||span>370)return [];
  const allowed=new Set(groups.flatMap(group=>group.ids.map(id=>group.scope+':'+id)));
  const counts=new Map();
  for(const row of rows){
    const key=String(row.source_scope||'')+':'+uid(row.category);
    const date=String(row.day||'').slice(0,10);
    if(!allowed.has(key)||date<startDate||date>endDate||!
      /^\d{4}-\d{2}-\d{2}$/.test(date)||Number(row.item_count)<=0)continue;
    if(!counts.has(key))counts.set(key,new Map());
    counts.get(key).set(date,(counts.get(key).get(date)||0)+Math.max(0,Number(row.item_count)||0));
  }
  return (Array.isArray(points)?points:[]).flatMap(point=>{
    const keys=placeMembers(point).map(member=>String(member.source_scope||'')+':'+uid(member.uid));
    if(!keys.length||keys.some(key=>!allowed.has(key)))return [];
    const days=new Set();
    let articles=0;
    for(const key of keys){
      for(const [day,count] of counts.get(key)||[]){days.add(day);articles+=count;}
    }
    const percent=Math.max(0,Math.min(100,Math.round(days.size/span*100)));
    return [{uid:uid(point.uid),source_scope:String(point.source_scope||''),
      percent,days:days.size,articles,span}];
  });
}
