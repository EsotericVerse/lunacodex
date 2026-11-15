import {timeUnitBucket} from './default-time-unit.mjs';
export function cultureDensityByUnit(rows=[],unit='day'){
  if(unit==='day')return rows;
  const seen=new Map();
  for(const row of rows){
    const bucket=timeUnitBucket(row.start_date||row.day,unit);
    if(!bucket){continue;}
    const key=String(row.category||'')+'\u0000'+bucket.startDate;
    const before=seen.get(key);
    if(before)before.item_count+=(Number(row.item_count)||0);
    else seen.set(key,{...row,start_date:bucket.startDate,end_date:bucket.endDate,
      item_count:Number(row.item_count)||0});
  }
  return [...seen.values()];
}
export function simpleTimeRiver(rows=[],mode='era'){
  const kind=mode==='anchor'?'anchor':'period';
  const entries=rows.filter(row=>row?.entry_type===kind&&row.uid);
  const groups=[],items=[],scopes=new Set();
  for(const row of entries){
    const scope=String(row.scope_id||'');
    if(!scopes.has(scope)){
      scopes.add(scope);
      groups.push({id:'time-mode:'+kind+':'+scope,label:kind==='anchor'?'定錨點':'期間',
        order:groups.length,collapsible:false});
    }
    const ranges=kind==='period'&&Array.isArray(row.ranges)&&row.ranges.length
      ?row.ranges:[row];
    for(const [index,range] of ranges.entries()){
      const start=String(range.start_date||row.start_date||'').slice(0,10);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(start))continue;
      const end=String(range.end_date||row.end_date||'').slice(0,10);
      items.push({id:'time-mode:'+kind+':'+scope+':'+row.uid+':'+index,
        uid:row.uid,entry_type:kind,scope_id:scope,
        group_key:'time-mode:'+kind+':'+scope,
        start_date:start,...(end>=start&&/^\d{4}-\d{2}-\d{2}$/.test(end)?{end_date:end}:{}),
        title:row.title||row.uid,display_label:kind==='anchor'?'●':row.title||row.uid,
        description:row.description||'',group_order:groups.length});
    }
  }
  return {items,groups};
}
export function traceHomeMapChoices(maps=[],display='anchor'){
  if(display==='anchor')return [];
  return maps.filter(row=>row.trace_type===display);
}
export function nearestTracePlaceIds(placeIds=[],anchors=[],selection=null){
  const byId=new Map(anchors.map(a=>[String(a.uid||''),a]));
  const source=selection?.trace_type==='space_anchor'?selection:byId.get(placeIds[0]);
  const coords=row=>{
    const lng=Number(row?.longitude),lat=Number(row?.latitude);
    return row?.longitude!=null&&row?.latitude!=null&&Number.isFinite(lng)&&Number.isFinite(lat)
      ?[lng,lat]:null;
  };
  const reference=coords(source);
  if(!reference)return placeIds;
  const lat0=reference[1]*Math.PI/180;
  const distance=id=>{
    const point=coords(byId.get(id));
    if(!point)return Number.POSITIVE_INFINITY;
    const dx=(point[0]-reference[0])*Math.PI/180*Math.cos(lat0);
    const dy=(point[1]-reference[1])*Math.PI/180;
    return dx*dx+dy*dy;
  };
  return [...placeIds].sort((a,b)=>distance(a)-distance(b));
}
