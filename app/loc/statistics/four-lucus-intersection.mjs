// Four on-demand comparison families, each using saved LOC ZModel hierarchy.
// Time: Era/Period; Space: Trace/Path; Keyword: Group/Item (stored summaries);
// Source: the complete Universe/Galaxy/Domain/From SiteLucus hierarchy.
// Each family exposes its own valid numeric projections; no leaf is flattened.
// No new Galaxy 媒體作品 statistics: Suno/Spotify/Youtube belong to SiteLucus.
import {resolveTimeSegments,resolveTimeTrace,timeDateWindows}
  from '../culture/time-lucus-ranges.mjs';
import {sourceStatisticsTree} from './source-tree-measures.mjs';

const UID=/^[A-Za-z0-9]{8}$/;
const DAY=/^\d{4}-\d{2}-\d{2}$/;
const num=value=>Math.max(0,Number(value)||0);
const cleanDay=value=>{
  const day=String(value??'').slice(0,10);
  return DAY.test(day)&&!Number.isNaN(Date.parse(day+'T00:00:00Z'))?day:'';
};
const attr=row=>{
  const value=row?.attr;
  if(typeof value==='string'){
    try{const parsed=JSON.parse(value);return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:{}}
    catch{return {}}
  }
  return value&&typeof value==='object'&&!Array.isArray(value)?value:{};
};
const refIds=value=>Array.isArray(value)?[...new Set(value.filter(v=>UID.test(String(v))))]:[];
const stableId=(kind,uid)=>kind+'\u0000'+uid;

export const INTERSECTION_FAMILIES=Object.freeze([
  {value:'time',label:'時間',types:['era','period']},
  {value:'space',label:'空間',types:['trace','path']},
  {value:'keyword',label:'關鍵詞',types:['keyword_group','keyword_item']},
  {value:'source',label:'來源',types:['source_tree']}
]);

const metric=(kind,row,extra={})=>({
  id:stableId(kind,String(row.uid)),
  kind,uid:String(row.uid),name:String(row.title||row.uid),...extra
});

const windowDays=windows=>(Array.isArray(windows)?windows:[]).reduce((sum,window)=>{
  const start=Date.parse(String(window.startDate||'')+'T00:00:00Z');
  const end=Date.parse(String(window.endDate||'')+'T00:00:00Z');
  return Number.isFinite(start)&&Number.isFinite(end)&&end>=start
    ?sum+Math.floor((end-start)/86400000)+1:sum;
},0);

export function timeIntersectionMetrics(lucus=[]){
  const all=(Array.isArray(lucus)?lucus:[]).filter(row=>UID.test(String(row?.uid)));
  const dates=new Map(all.filter(row=>row.type==='date').map(row=>[String(row.uid),row]));
  const periods=all.filter(row=>row.type==='period').map(row=>{
    const data=attr(row);
    const ranges=resolveTimeSegments(refIds(data.uid),dates);
    let windows=timeDateWindows(ranges);
    // Some older persisted Period rows have the original explicit dates but
    // not two live DateLucus endpoints. This is a saved date interval, not a
    // fabricated current-day or open-ended range.
    if(!windows.length&&Array.isArray(data.date)){
      const start=cleanDay(data.date[0]),end=cleanDay(data.date[1])||start;
      if(start&&end&&start<=end)windows=[{startDate:start,endDate:end}];
    }
    return {...metric('period',row,{
      windows,durationDays:windowDays(windows),
      dateAnchorCount:refIds(data.uid).length
    }),ranges};
  });
  // Era combines the actual Period windows, including older periods with
  // saved explicit date boundaries rather than surviving DateLucus endpoints.
  const byPeriod=new Map(periods.map(row=>[row.uid,{
    type:'period',ranges:row.windows.map(w=>({
      start_date:w.startDate,end_date:w.endDate,point:w.startDate===w.endDate,
      invalid:false
    }))
  }]));
  const eras=all.filter(row=>row.type==='era').map(row=>{
    const data=attr(row);
    const references=refIds(data.period);
    const traced=resolveTimeTrace(references,byPeriod);
    let windows=timeDateWindows(traced.ranges);
    if(!windows.length&&Array.isArray(data.date)){
      const start=cleanDay(data.date[0]),end=cleanDay(data.date[1])||start;
      if(start&&end&&start<=end)windows=[{startDate:start,endDate:end}];
    }
    return metric('era',row,{
      windows,children:references,durationDays:windowDays(windows),
      periodCount:references.length,childCount:references.length,
      dateAnchorCount:periods.filter(period=>references.includes(period.uid))
        .reduce((sum,period)=>sum+period.dateAnchorCount,0)
    });
  });
  const parentsByPeriod=new Map();
  for(const era of eras)for(const uid of era.children||[]){
    const parents=parentsByPeriod.get(uid)||[];
    parents.push(era.uid);parentsByPeriod.set(uid,parents);
  }
  return [...eras,...periods.map(period=>{
    const parents=parentsByPeriod.get(period.uid)||[];
    return {...period,parentUid:parents.length===1?parents[0]:null,parentUids:parents,
      childCount:period.dateAnchorCount};
  })];
}

export function spaceIntersectionMetrics(lucus=[]){
  const all=(Array.isArray(lucus)?lucus:[]).filter(row=>UID.test(String(row?.uid)));
  const visiblePoints=new Set(all.filter(row=>row.type==='point').map(row=>String(row.uid)));
  const parentTraces=new Map();
  for(const row of all.filter(item=>item.type==='trace'))
    for(const uid of refIds(attr(row).path)){
      const parents=parentTraces.get(uid)||[];
      parents.push(String(row.uid));parentTraces.set(uid,parents);
    }
  const paths=all.filter(row=>row.type==='path').map(row=>{
    const points=refIds(attr(row).point).filter(uid=>visiblePoints.has(uid));
    const parents=parentTraces.get(String(row.uid))||[];
    return metric('path',row,{
      points:new Set(points),pointCount:new Set(points).size,
      pathCount:1,childCount:points.size,
      parentUid:parents.length===1?parents[0]:null,parentUids:parents
    });
  });
  const byPath=new Map(paths.map(row=>[row.uid,row.points]));
  const traces=all.filter(row=>row.type==='trace').map(row=>{
    const data=attr(row);
    const points=new Set(refIds(data.point).filter(uid=>visiblePoints.has(uid)));
    for(const uid of refIds(data.path))
      for(const point of byPath.get(uid)||[])points.add(point);
    const children=refIds(data.path);
    return metric('trace',row,{
      points,children,pointCount:points.size,pathCount:children.length,childCount:children.length
    });
  });
  return [...traces,...paths];
}

// Reuse the existing Source tree engine: its from-alias mapping and UID
// rollups are shared by the interactive tree and by this comparison, rather
// than creating a competing taxonomy/SQL statistics pipeline.
export function sourceIntersectionMetrics(taxonomy={}){
  return sourceStatisticsTree([],taxonomy).metrics;
}

export function fourDimensionDailyCounts({
  selected=[],sourceRows=[],taxonomy={},placeRows=[],sourceModel=null
}={}){
  const chosen=(Array.isArray(selected)?selected:[]).filter(Boolean);
  const result=new Map(chosen.map(row=>[row.id,new Map()]));
  const add=(id,day,count)=>{
    const sum=result.get(id);if(!sum||!day||!count)return;
    sum.set(day,(sum.get(day)||0)+count);
  };
  const canonicalSource=sourceModel||sourceStatisticsTree(sourceRows,taxonomy);
  for(const row of sourceRows){
    const day=cleanDay(row?.day),count=num(row?.item_count);
    if(!day||!count)continue;
    if(row.kind==='source'){
      for(const id of canonicalSource.metricIdsForSite(row.category)){
        const metric=chosen.find(item=>item.id===id);
        // Each real From site contributes once to every saved ancestor UID:
        // Universe, Galaxy, Domain and its own From leaf. Selecting one level
        // never adds the already-rolled-up child totals a second time.
        if(metric?.kind==='source_tree'||
          metric?.kind==='source_unclassified')add(id,day,count);
      }
    }else if(row.kind==='total'){
      for(const metric of chosen){
        if(metric.kind!=='era'&&metric.kind!=='period')continue;
        if((metric.windows||[]).some(w=>day>=w.startDate&&day<=w.endDate))
          add(metric.id,day,count);
      }
    }
  }
  // Territory is already grouped by (day,point,site) and joined to visible
  // Points by SQL. One lucus can list the same Point repeatedly, but a
  // Point's articles contribute only once per selected Trace/Path metric.
  for(const row of placeRows){
    const day=cleanDay(row.day),point=String(row.place_id||''),
      count=num(row.item_count);
    if(!day||!count||!UID.test(point))continue;
    for(const node of chosen)
      if((node.kind==='trace'||node.kind==='path')&&
         node.points instanceof Set&&node.points.has(point))
        add(node.id,day,count);
  }
  return result;
}
