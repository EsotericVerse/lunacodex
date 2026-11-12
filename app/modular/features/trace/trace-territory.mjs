// Data-only projection for the annual Trace territory map. Every valid
// place_id remains a territory even when its Point has no mapped coordinates.
const UID=/^(?:[A-Za-z0-9]{4}|[A-Za-z0-9]{8})$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
export const territoryYearWindow=year=>{
  const n=Number(year);
  if(!Number.isInteger(n)||n<2000||n>2100)throw Error('無效的年度');
  return {startDate:n+'-01-01',endDate:n+'-12-31'};
};
export function territoryRegions(rows=[],year=2026){
  const {startDate,endDate}=territoryYearWindow(year),byPlace=new Map();
  for(const row of rows||[]){
    const uid=String(row.place_id||''),scope=String(row.source_scope||'');
    const day=String(row.day||'').slice(0,10);
    const count=Number(row.item_count||0);
    if(!UID.test(uid)||!scope||!DATE.test(day)||day<startDate||day>endDate||
      !Number.isFinite(count)||count<=0)continue;
    const key=scope+':'+uid;
    if(!byPlace.has(key))byPlace.set(key,{
      uid,source_scope:scope,total:0,sourceCounts:new Map(),days:new Map()
    });
    const place=byPlace.get(key),source=String(row.site||'').trim()||'其他來源';
    const sourceKey=source.toLocaleLowerCase(),old=place.sourceCounts.get(sourceKey);
    place.total+=count;
    place.sourceCounts.set(sourceKey,{name:old?.name||source,count:(old?.count||0)+count});
    place.days.set(day,(place.days.get(day)||0)+count);
  }
  return [...byPlace.values()].map(place=>({
    uid:place.uid,source_scope:place.source_scope,total:place.total,
    sources:[...place.sourceCounts.values()].map(({name,count})=>({
      name,count,percent:count/place.total*100
    })).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name)),
    timeline:[...place.days].sort(([a],[b])=>a.localeCompare(b)).map(([day,count])=>({day,count})),
    firstDay:[...place.days.keys()].sort()[0]||'',
    lastDay:[...place.days.keys()].sort().at(-1)||''
  })).sort((a,b)=>b.total-a.total||a.uid.localeCompare(b.uid));
}
export function territoryPointGroups(places=[],chunkSize=250){
  const groups=new Map();
  for(const place of places){
    if(!groups.has(place.source_scope))groups.set(place.source_scope,[]);
    groups.get(place.source_scope).push(place.uid);
  }
  return [...groups].flatMap(([scope,ids])=>
    Array.from({length:Math.ceil(ids.length/chunkSize)},(_,index)=>({
      scope,ids:ids.slice(index*chunkSize,(index+1)*chunkSize)
    })));
}
// PostgreSQL returns Point metadata with the already grouped Galaxy rows.
// Other SQL dialects continue using the existing bounded Point lookup.
export function territoryPointReadPlan(rows=[],regions=[]){
  const covered=new Set(),points=new Map();
  for(const row of rows){
    if(!row||!Object.hasOwn(row,'point_uid'))continue;
    const scope=String(row.source_scope||'');
    const placeId=String(row.place_id||'');
    if(!scope||!UID.test(placeId))continue;
    const key=scope+':'+placeId;
    covered.add(key);
    const id=String(row.point_uid||'');
    if(!UID.test(id)||id!==placeId||points.has(key))continue;
    const asCoordinate=value=>value==null||String(value).trim()===''?null:
      Number.isFinite(Number(value))?Number(value):null;
    points.set(key,{
      uid:id,source_scope:scope,trace_type:'space_anchor',
      title:String(row.point_title||'').trim()||'地點 '+id,
      longitude:asCoordinate(row.point_longitude),
      latitude:asCoordinate(row.point_latitude)
    });
  }
  return {
    points:[...points.values()],
    groups:territoryPointGroups(regions.filter(place=>
      !covered.has(place.source_scope+':'+place.uid)))
  };
}

export function territoryWithAnchors(regions=[],anchors=[]){
  const byId=new Map(anchors.map(point=>[point.source_scope+':'+point.uid,point]));
  return regions.map(place=>{
    const point=byId.get(place.source_scope+':'+place.uid);
    return {...place,title:point?.title||'地點 '+place.uid,
      point:point||null,longitude:point?.longitude??null,latitude:point?.latitude??null};
  });
}
