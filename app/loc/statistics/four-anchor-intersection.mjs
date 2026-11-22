// Four on-demand comparison families, each using saved LOC ZModel hierarchy.
// Time: Era/Period; Space: Trace/Path; Keyword: Group/Item (stored summaries);
// Source: Galaxy/Domain from silver.loc_anchor. From (site), Date and Point
// remain internal leaves and cannot be selected as comparison metrics.
// No new MediaAnchor statistics: Suno/Spotify/Youtube belong to SiteAnchor.
import {resolveTimeSegments,resolveTimeTrace,timeDateWindows}
  from '../culture/time-anchor-ranges.mjs';
import {assignedSource} from './member-intersection-model.mjs';

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
  {value:'source',label:'來源',types:['source_galaxy','source_domain']}
]);

const metric=(kind,row,extra={})=>({
  id:stableId(kind,String(row.uid)),
  kind,uid:String(row.uid),name:String(row.title||row.uid),...extra
});

export function timeIntersectionMetrics(anchors=[]){
  const all=(Array.isArray(anchors)?anchors:[]).filter(row=>UID.test(String(row?.uid)));
  const dates=new Map(all.filter(row=>row.type==='date').map(row=>[String(row.uid),row]));
  const periods=all.filter(row=>row.type==='period').map(row=>{
    const data=attr(row);
    const ranges=resolveTimeSegments(refIds(data.uid),dates);
    let windows=timeDateWindows(ranges);
    // Some older persisted Period rows have the original explicit dates but
    // not two live DateAnchor endpoints. This is a saved date interval, not a
    // fabricated current-day or open-ended range.
    if(!windows.length&&Array.isArray(data.date)){
      const start=cleanDay(data.date[0]),end=cleanDay(data.date[1])||start;
      if(start&&end&&start<=end)windows=[{startDate:start,endDate:end}];
    }
    return {...metric('period',row,{windows}),ranges};
  });
  // Era combines the actual Period windows, including older periods with
  // saved explicit date boundaries rather than surviving DateAnchor endpoints.
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
    return metric('era',row,{windows,children:references});
  });
  return [...eras,...periods];
}

export function spaceIntersectionMetrics(anchors=[]){
  const all=(Array.isArray(anchors)?anchors:[]).filter(row=>UID.test(String(row?.uid)));
  const visiblePoints=new Set(all.filter(row=>row.type==='point').map(row=>String(row.uid)));
  const paths=all.filter(row=>row.type==='path').map(row=>{
    const points=refIds(attr(row).point).filter(uid=>visiblePoints.has(uid));
    return metric('path',row,{points:new Set(points)});
  });
  const byPath=new Map(paths.map(row=>[row.uid,row.points]));
  const traces=all.filter(row=>row.type==='trace').map(row=>{
    const data=attr(row);
    const points=new Set(refIds(data.point).filter(uid=>visiblePoints.has(uid)));
    for(const uid of refIds(data.path))
      for(const point of byPath.get(uid)||[])points.add(point);
    return metric('trace',row,{points,children:refIds(data.path)});
  });
  return [...traces,...paths];
}

export function sourceIntersectionMetrics(taxonomy={}){
  return (taxonomy?.tree||[]).filter(node=>
    (node.type==='galaxy'||node.type==='domain')&&UID.test(String(node.uid)))
    .map(node=>metric(node.type==='galaxy'?'source_galaxy':'source_domain',node,{
      path:node.path||[],root:node.root
    }));
}

// Reconcile source aliases to the real SiteAnchor UID only. The Galaxy.site
// value is a source label; Galaxy.site_id is a native post identifier and is
// never inspected to select a Source subtree.
function sourceUidForSite(site,taxonomy={}){
  return assignedSource(site,taxonomy?.aliases||[],taxonomy?.categories||[]);
}

export function fourDimensionDailyCounts({
  selected=[],sourceRows=[],taxonomy={},timeMetrics=[],spaceMetrics=[],placeRows=[]
}={}){
  const chosen=(Array.isArray(selected)?selected:[]).filter(Boolean);
  const result=new Map(chosen.map(row=>[row.id,new Map()]));
  const add=(id,day,count)=>{
    const sum=result.get(id);if(!sum||!day||!count)return;
    sum.set(day,(sum.get(day)||0)+count);
  };
  const indexed=new Map((taxonomy?.tree||[]).map(row=>[row.uid,row]));
  const bySite=new Map();
  for(const row of sourceRows){
    const day=cleanDay(row?.day),count=num(row?.item_count);
    if(!day||!count)continue;
    if(row.kind==='source'){
      const site=String(row.category??'');
      if(!bySite.has(site)){
        const resolved=indexed.get(sourceUidForSite(site,taxonomy));
        bySite.set(site,new Set((resolved?.path||[]).filter(uid=>{
          const type=indexed.get(uid)?.type;
          return type==='galaxy'||type==='domain';
        })));
      }
      const ancestors=bySite.get(site);
      for(const node of chosen)if(
        (node.kind==='source_galaxy'||node.kind==='source_domain')&&
        ancestors.has(node.uid)
      )add(node.id,day,count);
    }else if(row.kind==='total'){
      for(const node of chosen){
        if(node.kind!=='era'&&node.kind!=='period')continue;
        if((node.windows||[]).some(w=>day>=w.startDate&&day<=w.endDate))
          add(node.id,day,count);
      }
    }
  }
  // Territory is already grouped by (day,point,site) and joined to visible
  // Points by SQL. One anchor can list the same Point repeatedly, but a
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
