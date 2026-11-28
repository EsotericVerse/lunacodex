'use client';
import FieldText from '../../../i18n/FieldText';
import {useUiLocale,useUiSection} from '../../../i18n/ui-locale';
import UiText,{useUiText} from '../../../i18n/UiText';

import {useEffect,useMemo,useState} from 'react';
import {useAsyncResource} from '../../../../packages/zenstack/client-queries';
import {selectScopeSourceBreakdownRows} from '../../../loc/galaxy/galaxy-query';
import StatisticsMultiChart from './StatisticsMultiChart';
import StatisticsChartFrame from './StatisticsChartFrame';
import StatisticsDetails from './StatisticsDetails';
import {sourceStatisticsTree} from '../../../loc/statistics/source-tree-measures.mjs';
import SourceTreePicker from './SourceTreePicker';
import {INTERSECTION_FAMILIES,timeIntersectionMetrics,spaceIntersectionMetrics,
  fourDimensionDailyCounts} from '../../../loc/statistics/four-lucus-intersection.mjs';
import {comparisonMetricGroups,selectedComparisonMetricGroup,firstAvailableGroupMetric} from './statistics-compare-options.mjs';
import {availableStatisticIntents,STATISTIC_INTENTS} from './statistics-time-zoom.mjs';

const DAY_MS=86400000;
// Only second/third hierarchy levels are selectable in each comparison lane.
// The existing SourceTreePicker still shows the full ancestry as navigation.
export const DIMENSION_FILTERS=Object.freeze(
  INTERSECTION_FAMILIES.map(({value,label})=>({value,label})));
export const DIMENSIONS=Object.freeze([
  {kind:'era',label:'時代'},{kind:'period',label:'時期'},
  {kind:'trace',label:'痕跡'},{kind:'path',label:'路徑'},
  {kind:'keyword_group',label:'關鍵詞 Group'},
  {kind:'keyword_item',label:'關鍵詞 Item'},
  {kind:'source_tree',label:'來源 Universe／Galaxy／Domain／From'}
]);
const dimensionForKind=kind=>kind==='source_tree'?'source':
  INTERSECTION_FAMILIES.find(row=>row.types.includes(kind))?.value||'source';
const metricId=(kind,value)=>kind+String.fromCharCode(0)+value;
const dateOnly=v=>String(v||'').slice(0,10);
function canonicalBucket(day,unit){
  const date=new Date(day+'T00:00:00Z');
  if(Number.isNaN(date.getTime()))return null;
  if(unit==='year'){
    const year=date.getUTCFullYear();
    return {key:String(year),from:year+'-01-01',to:year+'-12-31'};
  }
  if(unit==='month'){
    const a=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),1));
    const b=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0));
    return {key:a.toISOString().slice(0,7),from:a.toISOString().slice(0,10),to:b.toISOString().slice(0,10)};
  }
  if(unit==='week'){
    const start=new Date(date);
    start.setUTCDate(start.getUTCDate()-((start.getUTCDay()+6)%7));
    const end=new Date(start);end.setUTCDate(end.getUTCDate()+6);
    return {key:start.toISOString().slice(0,10),from:start.toISOString().slice(0,10),to:end.toISOString().slice(0,10)};
  }
  return {key:day,from:day,to:day};
}
export default function ScopeSelfIntersection({scope,range,classUid='',zoomLevel=0,onZoomLevelChange,sharedCatalog=null}){
  useUiSection('uiExtra.selfIntersection');
  useUiSection('uiExtra.statisticsView');
  const {locale,copy}=useUiLocale();
  const t=useUiText();
  const l=copy.uiExtra.selfIntersection;
  const [numberOfLanes,setNumberOfLanes]=useState(2);
  const [selected,setSelected]=useState([]);
  const [laneKinds,setLaneKinds]=useState([]);
  const [selectedPeriodKey,setSelectedPeriodKey]=useState('');
  const [chartIntent,setChartIntent]=useState('trend');
  const [selectedCategoryKey,setSelectedCategoryKey]=useState('');
  const [compareMetricKey,setCompareMetricKey]=useState('works');
  useEffect(()=>{
    setSelectedPeriodKey('');setSelectedCategoryKey('');setChartIntent('trend');
  },[scope?.id,range?.startDate,range?.endDate]);
  const [foldBlank,setFoldBlank]=useState(true);
  const start=dateOnly(range?.startDate),end=dateOnly(range?.endDate);
  const valid=Boolean(scope?.id&&scope.galaxy&&scope.lucus&&start&&end&&start<=end);
  const query=useAsyncResource(valid?['own-scope-source-intersection',scope?.id,start,end]:null,
    ()=>selectScopeSourceBreakdownRows(scope,{startDate:start,endDate:end}));
  const rows=query.data||[];
  const localCatalog=useAsyncResource(valid&&!sharedCatalog?['own-scope-source-catalog',scope?.id]:null,async()=>{
    const {readPublicSourceTaxonomy}=await import('../../../loc/source/catalog-public.mjs');
    return readPublicSourceTaxonomy();
  });
  const catalog=sharedCatalog||localCatalog;
  // The only Source dimension is Galaxy.site mapped through loc_lucus.
  // Mutlimedia is a Universe in the SAME Source tree, not a second counter.
  const sourceModel=useMemo(
    ()=>sourceStatisticsTree(rows,catalog.data||{}),[rows,catalog.data]);
  // Read the already-stored keyword summary only when this panel is expanded.
  const keywords=useAsyncResource({
    queryKey:['own-scope-keyword-summary',scope?.id,classUid,start,end],
    enabled:valid,
    queryFn:async()=>{
      const {selectKeywordAnalysisSummary}=await import('../../../loc/keywords/analysis');
      return selectKeywordAnalysisSummary({scopeId:scope.id,classUid,startDate:start,endDate:end});
    }
  });
  const keywordTabAvailable=Boolean(keywords.data?.statisticsEnabled&&
    (keywords.data?.runeTotals||[]).some(item=>Number(item.document_count)>0));
  // A dimension is an explicit user choice. Time/Space reads must not run
  // when opening Statistics or a Source/Keyword-only comparison.
  const availableKinds=INTERSECTION_FAMILIES.map(row=>row.value);
  const maximumLanes=8;
  const lanes=Math.max(2,Math.min(numberOfLanes,maximumLanes));
  const shownKinds=Array.from({length:lanes},(_,index)=>
    availableKinds.includes(laneKinds[index])?laneKinds[index]:
    index===0?'source':'keyword');
  const keywordModeActive=keywordTabAvailable&&shownKinds.includes('keyword');
  const timeLucus=useAsyncResource({
    queryKey:['scope-intersection-time-lucus',scope?.id],
    enabled:valid&&shownKinds.includes('time'),
    queryFn:async({signal})=>{
      const {readAllLucusFeature}=await import('../../../loc/model/feature-query-client.mjs');
      return readAllLucusFeature({scope:scope.id,family:'time',
        types:['era','period','date'],signal});
    },
    revalidateOnFocus:false,revalidateOnReconnect:false
  });
  const spaceLucus=useAsyncResource({
    queryKey:['scope-intersection-space-lucus',scope?.id],
    enabled:valid&&shownKinds.includes('space'),
    queryFn:async({signal})=>{
      const {readAllLucusFeature}=await import('../../../loc/model/feature-query-client.mjs');
      return readAllLucusFeature({scope:scope.id,family:'space',
        types:['trace','path','point'],signal});
    },
    revalidateOnFocus:false,revalidateOnReconnect:false
  });
  const territory=useAsyncResource({
    queryKey:['scope-intersection-territory',scope?.id,start,end],
    enabled:valid&&shownKinds.includes('space'),
    queryFn:async({signal})=>{
      signal?.throwIfAborted?.();
      const {queryTrace}=await import('../../../loc/actions/trace/queries.mjs');
      const {data}=await queryTrace({
        p_scope_id:scope.id,p_view:'trace_territory',
        p_start:start,p_end:end,p_options:{withPoints:false,statisticsOnly:true}
      });
      signal?.throwIfAborted?.();
      if(!Array.isArray(data))throw Error('Invalid territory statistics');
      return data;
    },
    revalidateOnFocus:false,revalidateOnReconnect:false
  });
  // Resolve Class -> group -> item from the current Scope's *real* keyword
  // catalog. Stored aggregate metadata has item labels but no group mapping.
  const keywordCatalog=useAsyncResource({
    queryKey:['scope-advanced-keyword-catalog',scope?.id,keywords.data?.keywordMeta?.class_uid],
    enabled:valid&&keywordModeActive&&Boolean(scope?.keywords&&keywords.data?.keywordMeta?.class_uid),
    queryFn:async()=>{
      const {keywordService}=await import('../../../loc/keywords/service-client.mjs');
      const {keywordClassCatalog}=await import('../../../loc/keywords/tree.mjs');
      const result=await keywordService('catalog',{
        scopeId:scope.id,classUid:keywords.data.keywordMeta.class_uid});
      if(!result.class_uid)return [];
      const {catalog}=keywordClassCatalog(result.rows,result.class_uid);
      return catalog.map(item=>({
        uid:item.uid,group_uid:item.group_uid,class_group:item.class_group,
        patternCount:Array.isArray(item.keywords)?item.keywords.length:0
      }));
    }
  });
  const keywordItemGroup=useMemo(()=>new Map((keywordCatalog.data||[])
    .filter(item=>item.class_enable!==false&&String(item.group_uid||''))
    .map(item=>[String(item.uid),String(item.group_uid)])),
  [keywordCatalog.data]);
  const keywordItemPatternCount=useMemo(()=>new Map((keywordCatalog.data||[])
    .map(item=>[String(item.uid),Math.max(0,Number(item.patternCount)||0)])),
  [keywordCatalog.data]);
  const timeMetrics=useMemo(()=>timeIntersectionMetrics(timeLucus.data||[]),
    [timeLucus.data]);
  const spaceMetrics=useMemo(()=>spaceIntersectionMetrics(spaceLucus.data||[]),
    [spaceLucus.data]);
  // Keep the one SiteLucus tree intact: Universe, Galaxy, Domain and From
  // are all real levels. Each level is a selectable numeric projection.
  const sourceMetrics=useMemo(()=>sourceModel.metrics,[sourceModel]);
  const hierarchyMetrics=useMemo(()=>[...timeMetrics,...spaceMetrics,...sourceMetrics],
    [timeMetrics,spaceMetrics,sourceMetrics]);
  const hierarchyCounts=useMemo(()=>fourDimensionDailyCounts({
    selected:hierarchyMetrics,sourceRows:rows,
    taxonomy:catalog.data||{},placeRows:territory.data||[],sourceModel
  }),[hierarchyMetrics,rows,catalog.data,territory.data,sourceModel]);
  const categoryList=useMemo(()=>{
    const hierarchy=hierarchyMetrics.map(item=>({
      ...item,total:[...(hierarchyCounts.get(item.id)?.values()||[])]
        .reduce((sum,n)=>sum+Number(n||0),0)
    }));
    const analysis=keywords.data?.statisticsEnabled?keywords.data:null;
    const groups=(analysis?.groupTotals||[])
      .filter(row=>Number(row.document_count||0)>0)
      .map(row=>({
        id:metricId('keyword_group',row.group_uid),kind:'keyword_group',
        uid:String(row.group_uid),parentUid:String(analysis?.keywordMeta?.class_uid||''),
        name:String(row.group||row.group_uid),total:Number(row.document_count)||0,
        childCount:(keywordCatalog.data||[]).filter(item=>
          String(item.group_uid)===String(row.group_uid)).length
      }));
    const items=(analysis?.runeTotals||[])
      .filter(row=>Number(row.document_count||0)>0)
      .map(row=>({
        id:metricId('keyword_item',row.uid),kind:'keyword_item',
        uid:String(row.uid),group_uid:keywordItemGroup.get(String(row.uid))||'',
        parentUid:keywordItemGroup.get(String(row.uid))||'',
        name:String(row.label||row.uid),total:Number(row.document_count)||0,
        patternCount:keywordItemPatternCount.get(String(row.uid))||0,
        childCount:keywordItemPatternCount.get(String(row.uid))||0
      }));
    return [...hierarchy,...groups,...items];
  },[hierarchyMetrics,hierarchyCounts,keywords.data,keywordItemGroup,
    keywordItemPatternCount,keywordCatalog.data]);
  const candidatesForLane=index=>categoryList.filter(item=>
    dimensionForKind(item.kind)===shownKinds[index]&&item.total>0)
    .sort((a,b)=>b.total-a.total||a.name.localeCompare(b.name));
  const chosen=Array.from({length:lanes},(_,index)=>{
    const candidates=candidatesForLane(index);
    const id=selected[index];
    if(id&&candidates.some(item=>item.id===id)&&!selected.slice(0,index).includes(id))return id;
    const reserved=new Set(selected.filter((_,position)=>position!==index));
    return candidates.find(item=>!reserved.has(item.id))?.id||'';
  });
  const used=new Set();
  const selection=chosen.map((id,index)=>{
    const options=candidatesForLane(index);
    const output=id&&!used.has(id)?id:options.find(item=>!used.has(item.id))?.id||'';
    if(output)used.add(output);
    return output;
  });
  const categories=selection.map(id=>categoryList.find(c=>c.id===id)).filter(Boolean);
  const selectedKeywordItems=categories.some(item=>item.kind==='keyword_item');
  // Item-by-day data are not in the summary RPC. Load saved attributes only
  // when an item is actually selected, without reading or analyzing article bodies.
  const keywordItems=useAsyncResource({
    queryKey:['own-scope-keyword-item-days',scope?.id,classUid,start,end],
    enabled:valid&&keywordModeActive&&selectedKeywordItems,
    queryFn:async()=>{
      const {keywordService}=await import('../../../loc/keywords/service-client.mjs');
      return keywordService('summary',{scopeId:scope.id,
        classUid:keywords.data?.keywordMeta?.class_uid||classUid,
        startDate:start,endDate:end});
    }
  });
  const unit=['year','month','week','day'].includes(range?.bucket)?range.bucket:(Date.parse(end)-Date.parse(start))/DAY_MS>180?'month':(Date.parse(end)-Date.parse(start))/DAY_MS>60?'week':'day';
  const calculated=useMemo(()=>{
    if(!valid||!categories.length)return {chart:[],days:[],totals:[]};
    const counts=new Map(), activeDays=new Map();
    const selectedIds=new Set(categories.map(category=>category.id));
    const add=(day,id,value)=>{
      if(!selectedIds.has(id)||!day||day<start||day>end||value<=0)return;
      const bucket=canonicalBucket(day,unit);
      if(!bucket)return;
      const item=counts.get(bucket.key)||{period:bucket.key,start_date:bucket.from,end_date:bucket.to};
      item[id]=(Number(item[id])||0)+value;
      counts.set(bucket.key,item);
      const active=activeDays.get(day)||new Set();
      active.add(id);
      activeDays.set(day,active);
    };
    // Every selected metric receives its own daily aggregate. If an article
    // lies in a parent and child, it is not counted twice inside either lane.
    for(const [id,byDay] of hierarchyCounts)
      for(const [day,count] of byDay)add(day,id,count);
    // One Class per article. The existing summary already aggregates by day.
    for(const row of keywords.data?.classifications||[]){
      add(dateOnly(row.date),'keyword_group'+String.fromCharCode(0)+row.group_uid,Number(row.count)||0);
    }
    if(selectedKeywordItems){
      for(const row of keywordItems.data||[]){
        if(row.kind==='item_day')
          add(dateOnly(row.day),metricId('keyword_item',String(row.item_key)),
            Number(row.document_count)||0);
      }
    }
    const chart=[];
    for(let date=new Date(start+'T00:00:00Z'),limit=new Date(end+'T00:00:00Z');date<=limit;){
      const day=date.toISOString().slice(0,10);
      const bucket=canonicalBucket(day,unit);
      const previous=chart.at(-1);
      if(previous?.period!==bucket.key)chart.push({
        period:bucket.key,start_date:bucket.from,end_date:bucket.to,
        ...Object.fromEntries(categories.map(category=>[category.id,Number(counts.get(bucket.key)?.[category.id])||0]))
      });
      date=new Date(bucket.to+'T00:00:00Z');date.setUTCDate(date.getUTCDate()+1);
    }
    return {
      chart,
      days:[...activeDays.values()].filter(day=>categories.every(category=>day.has(category.id))).length,
      totals:categories.map(category=>({
        id:category.id,name:category.name,
        value:chart.reduce((n,bucket)=>n+Number(bucket[category.id]||0),0),
        activePeriods:chart.filter(bucket=>Number(bucket[category.id]||0)>0).length
      }))
    };
  },[hierarchyCounts,categories.map(c=>c.id).join(String.fromCharCode(0)),
    start,end,unit,valid,keywords.data,keywordItems.data,selectedKeywordItems]);
  const series=categories.map(c=>({key:c.id,label:c.name}));
  const categoryKey=categories.map(category=>category.id).join('|');
  useEffect(()=>setSelectedCategoryKey(''),[categoryKey]);
  const totalsById=new Map(calculated.totals.map(item=>[item.id,item]));
  const rangeDays=Math.max(0,Math.floor((Date.parse(end+'T00:00:00Z')-
    Date.parse(start+'T00:00:00Z'))/DAY_MS)+1);
  const chartMetricRows=categories.map(category=>{
    const total=totalsById.get(category.id)?.value||0;
    const activePeriods=totalsById.get(category.id)?.activePeriods||0;
    return {
      ...category,uid:category.uid||category.id,title:category.name,label:category.name,
      works:total,activePeriods,
      durationDays:category.durationDays,
      dateAnchorCount:category.dateAnchorCount,
      pointCount:category.pointCount,
      pathCount:category.pathCount,
      childCount:category.childCount,
      descendantCount:category.descendantCount,
      fromCount:category.fromCount,
      patternCount:category.patternCount
    };
  }).filter(row=>row.works>0);
  const metricDefinitions=[
    {key:'works',label:'作品數',unit:'篇'},
    {key:'durationDays',label:'時間跨度',unit:'日'},
    {key:'dateAnchorCount',label:'日期定錨數',unit:'個'},
    {key:'pointCount',label:'Point 數',unit:'個'},
    {key:'pathCount',label:'Path 數',unit:'條'},
    {key:'patternCount',label:'Pattern 數',unit:'個'},
    {key:'childCount',label:'直接子節點數',unit:'個'},
    {key:'descendantCount',label:'下層節點數',unit:'個'},
    {key:'fromCount',label:'From 來源數',unit:'個'},
    {key:'activePeriods',label:'活躍區間數',unit:'個'}
  ];
  const metricOptions=metricDefinitions.filter(metric=>
    chartMetricRows.length>=2&&chartMetricRows.every(row=>
      row[metric.key]!==null&&row[metric.key]!==undefined&&
      Number.isFinite(Number(row[metric.key]))));
  const effectiveMetricKey=metricOptions.some(metric=>metric.key===compareMetricKey)
    ?compareMetricKey:'works';
  const distribution=chartMetricRows.map(row=>({
    key:row.id,name:row.name,value:Number(row[effectiveMetricKey])||0
  })).filter(item=>item.value>0);
  const values=chartMetricRows.map(row=>({
    uid:row.uid,label:row.name,value:Number(row[effectiveMetricKey])||0,
    metric:effectiveMetricKey
  })).filter(row=>Number.isFinite(row.value));
  const recordFields=metricOptions.map(metric=>metric);
  const selectedSeries=selectedCategoryKey
    ?series.filter(field=>field.key===selectedCategoryKey):series;
  const selectedCategory=categories.find(category=>category.id===selectedCategoryKey)||null;
  const exclusive=(()=>{
    if(categories.length<2)return false;
    const first=categories[0];
    if(!categories.every(row=>row.kind===first.kind&&
      String(row.parentUid||'')===String(first.parentUid||'')))return false;
    if(first.kind==='keyword_group'||first.kind==='source_tree')return true;
    if(first.kind==='period'||first.kind==='era'){
      const windows=categories.map(row=>row.windows||[]);
      for(let i=0;i<windows.length;i++)for(let j=i+1;j<windows.length;j++)
        for(const a of windows[i])for(const b of windows[j])
          if(a.startDate<=b.endDate&&b.startDate<=a.endDate)return false;
      return true;
    }
    if(first.kind==='path'||first.kind==='trace'){
      const seen=new Set();
      for(const row of categories)for(const point of row.points||[]){
        if(seen.has(point))return false;
        seen.add(point);
      }
      return true;
    }
    return false;
  })();
  const chartIntentOptions=availableStatisticIntents({
    rows:calculated.chart,series,distribution,
    records:chartMetricRows,recordFields,values,
    mutuallyExclusive:exclusive,seriesExclusive:exclusive,
    attainmentValue:calculated.days,targetValue:rangeDays
  });
  const effectiveChartIntent=chartIntentOptions.includes(chartIntent)?chartIntent:'trend';
  const visibleSeries=selectedCategoryKey
    ?series.filter(field=>field.key===selectedCategoryKey):series;
  const enough=maximumLanes>=2&&categories.length===lanes;
  const selectedPoint=calculated.chart.find(row=>row.period===selectedPeriodKey)||null;
  const selectedPointCategories=selectedCategory?[selectedCategory]:categories;
  const selectComparisonCategory=key=>{
    setSelectedCategoryKey(String(key||''));
    setChartIntent('trend');
    setSelectedPeriodKey('');
  };

  return <section className="scope-stat-section scope-self-intersection" aria-label={t('uiExtra.statisticsView.selfIntersectionTitle')}>
    <h3><UiText id="uiExtra.statisticsView.selfIntersectionTitle"/></h3>
      {query.isPending||keywords.isPending?<p className="scope-status">{l.readingSources}</p>:null}
      {shownKinds.includes('time')&&timeLucus.isPending
        ?<p className="scope-status" role="status">正在讀取時代／時期…</p>:null}
      {shownKinds.includes('space')&&(spaceLucus.isPending||territory.isPending)
        ?<p className="scope-status" role="status">正在讀取痕跡／路徑…</p>:null}
      {query.error||catalog.error?<p className="scope-status scope-error">{String(query.error?.message||catalog.error?.message||l.readFailed)}</p>:null}
      {keywords.error?<p className="scope-status scope-error">關鍵詞分佈載入失敗：{String(keywords.error?.message||keywords.error)}</p>:null}
      {timeLucus.error?<p className="scope-status scope-error">時代／時期讀取失敗：{String(timeLucus.error?.message||timeLucus.error)}</p>:null}
      {spaceLucus.error||territory.error?<p className="scope-status scope-error">痕跡／路徑讀取失敗：{String(spaceLucus.error?.message||territory.error?.message||'')}</p>:null}
      {!query.isPending&&!catalog.isPending&&!query.error&&!catalog.error?<div className="scope-self-intersection-content">
        <div className="scope-stat-controls">
          <label><span><FieldText text="比較組數"/></span>
            <select className="scope-select" value={lanes} onChange={e=>{setNumberOfLanes(Number(e.target.value));setSelected([])}}>
              {Array.from({length:Math.max(0,maximumLanes-1)},(_,i)=>i+2).map(n=><option key={n} value={n}>{n}{l.groupUnit}</option>)}
              {maximumLanes<2?<option value={2}>可比較項目不足</option>:null}
            </select>
          </label>
        </div>
        <div className="scope-self-intersection-comparisons">
          {Array.from({length:lanes},(_,index)=>{
            const kind=shownKinds[index];
            const chosenId=selection[index]||'';
            const selectMetric=id=>setSelected(previous=>{
              const next=[...selection];next[index]=id;return next;
            });
            const switchKind=nextKind=>{
              setLaneKinds(previous=>{
                const next=[...shownKinds];next[index]=nextKind;return next;
              });
              setSelected(previous=>{
                const next=[...selection];next[index]='';return next;
              });
            };
            const ofKind=type=>categoryList.filter(item=>item.kind===type);
            const eras=ofKind('era'),periods=ofKind('period');
            const linkedPeriods=new Set(eras.flatMap(x=>x.children||[]));
            const times=[
              ...eras.map(parent=>({name:parent.name,item:parent,
                items:periods.filter(item=>parent.children?.includes(item.uid))})),
              ...(!periods.some(item=>!linkedPeriods.has(item.uid))?[]:[{
                name:'未歸屬時期',items:periods.filter(item=>!linkedPeriods.has(item.uid))
              }])
            ];
            const traces=ofKind('trace'),paths=ofKind('path');
            const linkedPaths=new Set(traces.flatMap(x=>x.children||[]));
            const spaces=[
              ...traces.map(parent=>({name:parent.name,item:parent,
                items:paths.filter(item=>parent.children?.includes(item.uid))})),
              ...(!paths.some(item=>!linkedPaths.has(item.uid))?[]:[{
                name:'未歸屬路徑',items:paths.filter(item=>!linkedPaths.has(item.uid))
              }])
            ];
            const keywordGroups=ofKind('keyword_group').map(parent=>({
              name:parent.name,item:parent,
              items:ofKind('keyword_item').filter(item=>item.group_uid===parent.uid)
            }));
            const groups=comparisonMetricGroups(kind,{
              time:times,space:spaces,keyword:keywordGroups
            });
            const currentGroup=selectedComparisonMetricGroup(groups,chosenId);
            const selectedGroupMetrics=currentGroup?.options||[];
            const takenByOther=new Set(selection.filter((_,lane)=>lane!==index));
            return <section className="scope-self-intersection-lane" key={index}
              aria-label={l.comparisonItem+' '+(index+1)}>
              <strong>{l.comparisonItem} {index+1}</strong>
              <div className="scope-self-intersection-kind-tabs" role="group"
                aria-label={l.comparisonItem+' '+(index+1)+' 類型'}>
                {DIMENSION_FILTERS.map(tab=>
                  <button type="button" className="scope-self-stat-tab" key={tab.value}
                    aria-pressed={kind===tab.value} onClick={()=>switchKind(tab.value)}>
                    {tab.label}
                  </button>)}
              </div>
              <div className="scope-self-intersection-category-groups">
                {kind==='source'?<SourceTreePicker
                  metrics={sourceModel.metrics} value={chosenId} takenIds={takenByOther}
                  onChange={selectMetric}
                  label={l.comparisonItem+' '+(index+1)+' 來源 Universe／Galaxy／Domain／From'}/>:null}
                {kind!=='source'?<label className="scope-self-stat-picker"><span>上層分類</span>
                  <select className="scope-select" aria-label={l.comparisonItem+' '+(index+1)+' 上層分類'}
                    value={currentGroup?.key||''}
                    onChange={event=>{
                      const target=groups.find(group=>group.key===event.target.value);
                      const id=firstAvailableGroupMetric(target,takenByOther);
                      if(id)selectMetric(id);
                    }}>
                    {!groups.length?<option value="">無可用類別</option>:null}
                    {groups.map(group=><option key={group.key} value={group.key}
                      disabled={!firstAvailableGroupMetric(group,takenByOther)}>{group.name}</option>)}
                  </select>
                </label>:null}
                {kind!=='source'?<label className="scope-self-stat-picker"><span>階層項目</span>
                  <select className="scope-select" aria-label={l.comparisonItem+' '+(index+1)+' 階層項目'}
                    value={selectedGroupMetrics.some(item=>item.id===chosenId)?chosenId:''}
                    disabled={!selectedGroupMetrics.length}
                    onChange={event=>selectMetric(event.target.value)}>
                    {!selectedGroupMetrics.length?<option value="">無可用項目</option>:null}
                    {selectedGroupMetrics.map(item=><option key={item.id} value={item.id}
                      disabled={takenByOther.has(item.id)}>{item.name}</option>)}
                  </select>
                </label>:null}
                {kind==='keyword'?keywordCatalog.isPending
                  ?<p className="scope-status" role="status">正在讀取組內項目…</p>:null:null}
                {kind==='keyword'&&keywordCatalog.error?<p role="alert" className="scope-status scope-error">
                  組內關鍵詞讀取失敗：{String(keywordCatalog.error?.message||keywordCatalog.error)}
                </p>:null}
                {kind!=='source'&&!groups.length?<p className="scope-status">目前沒有可用的上層／下層項目</p>:null}
              </div>
            </section>;
          })}
        </div>
        {chartIntentOptions.length>1?<div className="scope-stat-controls">
          <label><span>分析意圖</span>
            <select className="scope-select" value={effectiveChartIntent} onChange={event=>{
              setChartIntent(event.target.value);setSelectedPeriodKey('');setSelectedCategoryKey('');
            }}>
              {chartIntentOptions.map(value=><option key={value} value={value}>
                {STATISTIC_INTENTS.find(([id])=>id===value)?.[1]||value}
              </option>)}
            </select>
          </label>
          {['compare','ranking','distribution','composition'].includes(effectiveChartIntent)&&metricOptions.length>1
            ?<label><span>分析數值</span>
              <select className="scope-select" value={effectiveMetricKey}
                onChange={event=>setCompareMetricKey(event.target.value)}>
                {metricOptions.map(metric=><option key={metric.key} value={metric.key}>
                  {metric.label}（{metric.unit}）
                </option>)}
              </select>
            </label>:null}
          {selectedCategory?<button type="button" className="loc-button loc-button--small"
            onClick={()=>{setSelectedCategoryKey('');setChartIntent('compare');setSelectedPeriodKey('');}}>
            返回比較
          </button>:null}
          {['trend','compositionTrend'].includes(effectiveChartIntent)
            ?<label className="scope-setting-toggle">
              <input type="checkbox" checked={foldBlank} onChange={e=>setFoldBlank(e.target.checked)}/> {l.foldEmptyTime}
            </label>:null}
        </div>:null}
        {selectedKeywordItems&&keywordItems.isPending?<p className="scope-status" role="status">正在讀取關鍵詞項目的每日統計…</p>:null}
        {selectedKeywordItems&&keywordItems.error?<p role="alert" className="scope-status scope-error">{String(keywordItems.error?.message||keywordItems.error)}</p>:null}
        {enough&&(!selectedKeywordItems||keywordItems.isSuccess)?<div>
          <StatisticsChartFrame level={zoomLevel} onChange={onZoomLevelChange} range={range} idPrefix="scope-self-stat">
            <StatisticsMultiChart intent={effectiveChartIntent}
              rows={['trend','compositionTrend'].includes(effectiveChartIntent)
                ?calculated.chart:[]}
              series={['trend','compositionTrend'].includes(effectiveChartIntent)
                ?visibleSeries:[]}
              distribution={distribution} values={values}
              records={chartMetricRows} recordFields={recordFields}
              mutuallyExclusive={exclusive} seriesExclusive={exclusive}
              attainmentValue={calculated.days} targetValue={rangeDays}
              attainmentLabel="共同活躍日涵蓋率" attainmentTargetLabel="選取範圍日數"
              foldBlank={['trend','compositionTrend'].includes(effectiveChartIntent)&&foldBlank}
              height={410} activeCategoryKey={selectedCategoryKey}
              onCategoryClick={['compare','ranking','composition'].includes(effectiveChartIntent)
                ?selectComparisonCategory:null}
              selectedPeriodKey={selectedPeriodKey}
              onPeriodClick={['trend','compositionTrend'].includes(effectiveChartIntent)
                ?row=>setSelectedPeriodKey(String(row?.period||'')):null}/>
          </StatisticsChartFrame>
          {selectedPoint&&['trend','compositionTrend'].includes(effectiveChartIntent)
            ?<section className="scope-self-intersection-selected" aria-live="polite">
            <header className="statistics-dashboard__panel-heading">
              <h4>{selectedPoint.period} · 選取時段</h4>
              <button type="button" className="loc-button loc-button--small"
                onClick={()=>setSelectedPeriodKey('')}>清除選取</button>
            </header>
            <div className="scope-ranking">
              {selectedPointCategories.map(category=><div key={category.id}>
                <strong>{category.name}</strong>
                <span>{Number(selectedPoint[category.id]||0).toLocaleString(locale)}{l.recordUnit}</span>
              </div>)}
            </div>
          </section>:null}
          <p className="scope-status">交錯以「同日活躍」計算。TLucus 使用 Era／Period 與時間跨度；LLucus 使用 Trace／Path 與 Point 數；KLucus 使用 Group／Item 與 Pattern 數；SLucus 使用 Universe／Galaxy／Domain／From 與階層數量。父子節點各自統計，不把重疊的父子總數相加成獨立作品數；同日出現不代表同篇文章交集。</p>
          <StatisticsDetails>{()=><>
          <div className="scope-ranking">
            <div><strong>{l.activeDays}</strong><span>{calculated.days.toLocaleString(locale)}{l.dayUnit}</span></div>
            {calculated.totals.map(item=><div key={item.name}><strong>{item.name}</strong><span>{item.value.toLocaleString(locale)}{l.recordUnit}</span></div>)}
          </div>
          </>}</StatisticsDetails>
        </div>:!enough?<p className="scope-status">{l.notEnoughSources.replace('{count}',lanes)}</p>:null}
      </div>:null}
  </section>;
}
