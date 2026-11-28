'use client';

import {useUiCopy,useUiLocale,useUiSection} from '../../i18n/ui-locale';
import UiText,{useUiText} from '../../i18n/UiText';

import {useEffect,useMemo,useState} from 'react';
import {motion,useReducedMotion} from 'motion/react';
import dynamic from 'next/dynamic';
import {useRouter,useSearchParams} from 'next/navigation';
import {useAsyncResource,useResourceCache,prepareTransientResourceAction} from '../../../packages/zenstack/client-queries';

// Defer Galaxy's data/query engine until the selected statistics mode needs it.
const loadGalaxyStatistics=()=>import('../../loc/galaxy/galaxy-query');


import {defaultScopeData} from '../../loc/scope/scope-data';
import {featureNavigationHref,readFeatureNavigation} from '../routing/feature-navigation';
import {featureDataErrorMessage} from '../feature-data-state';
import {useScopeRuntime} from '../use-scope-runtime';
import useDefaultTimeUnit from '../../loc/preferences/use-default-time-unit';
import {FeaturePage} from '../ui';
import {assignedSource} from '../../loc/statistics/member-intersection-model.mjs';
import {groupedSourceOutline} from '../../loc/source/outline-options.mjs';
import {administrativeSourceTrend} from '../../loc/statistics/admin-source.mjs';
import {usePassiveSessionAccount} from '../../loc/auth/use-account';
import {availableStatisticIntents,STATISTIC_INTENTS} from '../modules/statistics/statistics-time-zoom.mjs';
const StatisticsMultiChart=dynamic(()=>import('../modules/statistics/StatisticsMultiChart'),{loading:()=>null});
const Rune66Summary=dynamic(()=>import('../modules/statistics/StatisticsMultiChart').then(m=>m.Rune66Summary),{loading:()=>null});
const KeywordPatternSummary=dynamic(()=>import('../modules/statistics/KeywordPatternSummary'),{loading:()=>null});
const ScopeSelfIntersection=dynamic(()=>import('../modules/statistics/ScopeSelfIntersection'),{loading:()=>null});
const ScopeGroupStatistics=dynamic(()=>import('../modules/statistics/ScopeGroupStatistics'),{loading:()=>null});
const ScopeGroupOverview=dynamic(()=>import('../../loc/scope/ScopeGroupOverview'),{loading:()=>null});
const StatisticsInsightsPanel=dynamic(()=>import('../modules/statistics/StatisticsInsightsPanel'),{loading:()=>null});
const StatisticsInsightsRail=dynamic(()=>import('../modules/statistics/StatisticsInsightsPanel').then(m=>m.StatisticsInsightsRail),{loading:()=>null});
import StatisticsChartFrame from '../modules/statistics/StatisticsChartFrame';
import StatisticsDetails from '../modules/statistics/StatisticsDetails';
import StatisticsDashboardKpis from '../modules/statistics/StatisticsDashboardKpis';
import ActivityMotion from '../ActivityMotion';
import {statisticsZoomWindow} from '../modules/statistics/statistics-time-zoom.mjs';
import {DEFAULT_YEAR_WINDOW} from '../../loc/preferences/default-year-window.mjs';

const STAT_TYPES=['total','source','keywords','place'];
const STAT_TYPE_KEYS=Object.freeze({
  total:'statistics.totalSource',
  source:'uiExtra.statisticsUI.sourceGroup',
  keywords:'uiExtra.statisticsUI.keywordClass'
});
function dateKey(value){
  const key=String(value||'').slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(key)?key:'';
}
function taipeiDateKey(date=new Date()){
  try{
    const parts=new Intl.DateTimeFormat('en-US',{
      timeZone:'Asia/Taipei',
      year:'numeric',
      month:'2-digit',
      day:'2-digit'
    }).formatToParts(date);
    const value=Object.fromEntries(parts.map(part=>[part.type,part.value]));
    return `${value.year}-${value.month}-${value.day}`;
  }catch{
    return date.toISOString().slice(0,10);
  }
}
function trendBucket(value,unit){
  const key=dateKey(value);
  if(!key)return null;
  const date=new Date(key+'T00:00:00Z');
  const year=date.getUTCFullYear();
  const month=date.getUTCMonth();
  if(unit==='year'){
    return {key:String(year),label:String(year),start:year+'-01-01',end:year+'-12-31'};
  }
  if(unit==='month'){
    const monthText=String(month+1).padStart(2,'0');
    const end=new Date(Date.UTC(year,month+1,0)).toISOString().slice(0,10);
    return {key:year+'-'+monthText,label:year+'/'+monthText,start:year+'-'+monthText+'-01',end};
  }
  if(unit==='week'){
    const day=date.getUTCDay();
    date.setUTCDate(date.getUTCDate()+(day===0?-6:1-day));
    const start=date.toISOString().slice(0,10);
    const endDate=new Date(date);endDate.setUTCDate(endDate.getUTCDate()+6);
    return {key:start,label:start.slice(5).replace('-','/'),start,end:endDate.toISOString().slice(0,10)};
  }
  return {key,label:key.slice(5).replace('-','/'),start:key,end:key};
}
function rowsInWindow(rows=[],range={}){
  const startDate=dateKey(range.startDate),endDate=dateKey(range.endDate);
  const bucket=['year','month','week','day'].includes(range.bucket)?range.bucket:'day';
  if(!startDate||!endDate||startDate>endDate)return {rows:[],startDate:'',endDate:'',bucket};
  return {rows:rows.filter(row=>{
    const day=dateKey(row.day);
    return day&&day>=startDate&&day<=endDate;
  }),startDate,endDate,bucket};
}
function facetTotals(rows=[]){
  const map=new Map();
  for(const row of rows){
    const category=String(row.category||'').trim();
    if(!category)continue;
    const key=category.normalize('NFKC').toLocaleLowerCase();
    const existing=map.get(key);
    if(existing)existing.item_count+=(Number(row.item_count)||0);
    else map.set(key,{term:category,item_count:Number(row.item_count)||0});
  }
  return [...map.values()].sort((a,b)=>b.item_count-a.item_count||a.term.localeCompare(b.term));
}
function facetTrend(rows=[],window={},selectedCategories=[]){
  if(!window.startDate||!window.endDate)return [];
  // Recharts treats dotted dataKey strings as object paths, so a location
  // such as a street/domain name must use a stable ordinal key instead.
  const categories=new Map(selectedCategories.map((value,index)=>[
    String(value).normalize('NFKC').toLocaleLowerCase(),'category_'+index
  ]));
  const buckets=new Map();
  for(let cursor=new Date(window.startDate+'T00:00:00Z'),end=new Date(window.endDate+'T00:00:00Z');cursor<=end;cursor.setUTCDate(cursor.getUTCDate()+1)){
    const bucket=trendBucket(cursor.toISOString().slice(0,10),window.bucket);
    if(bucket&&!buckets.has(bucket.key))buckets.set(bucket.key,{period:bucket.label,_sort:bucket.key,
      start_date:bucket.start,end_date:bucket.end});
  }
  for(const row of rows){
    const canonical=categories.get(String(row.category||'').normalize('NFKC').toLocaleLowerCase());
    if(!canonical)continue;
    const bucket=trendBucket(row.day,window.bucket);
    if(!bucket)continue;
    const output=buckets.get(bucket.key);
    if(output)output[canonical]=(Number(output[canonical])||0)+(Number(row.item_count)||0);
  }
  return [...buckets.values()].sort((a,b)=>a._sort.localeCompare(b._sort)).map(row=>{
    const output={period:row.period,start_date:row.start_date,end_date:row.end_date};
    for(let index=0;index<selectedCategories.length;index++){
      const key='category_'+index;
      output[key]=Number(row[key])||0;
    }
    return output;
  });
}

function StatisticTypeSelect({scopeId,navigation,types}) {
  const {locale}=useUiLocale();
  const t=useUiText();
  const router=useRouter();
  // The frame paints before the route dictionary arrives. Keep these control
  // labels readable during that short window instead of exposing raw keys.
  const pageText=(key,traditional,english)=>{
    const value=t(key);
    return value===key||!value?(locale==='en'?english:traditional):value;
  };
  // Pick one ZModel dimension. The Source subtree is picked in a separate
  // field only when Source is active, avoiding duplicate long dropdowns.
  const requested=String(navigation.rankingType||'');
  const active=types.includes(requested)?requested:
    (['media_type','media_platform','media_style','media'].includes(requested)?'source':types[0]||'');
  if(!types.length)return null;
  return <label>
    <span>{pageText('statistics.item','統計項目','Item')}</span>
    <select id="statistics-ranking-type" className="scope-select" value={active} onChange={event=>{
      const value=event.target.value;
      if(!value||value===active)return;
      router.push(featureNavigationHref(scopeId,'statics',{
        ...navigation,rankingType:value,source:undefined
      }));
    }}>
      {types.includes('total')?<option value='total'>{pageText(STAT_TYPE_KEYS.total,'作品總數','Total works')}</option>:null}
      {types.includes('source')?<option value="source">{pageText(STAT_TYPE_KEYS.source,'文章來源分類','Source category')}</option>:null}
      {types.includes('keywords')?<optgroup label="關鍵詞">
        <option value="keywords">{pageText(STAT_TYPE_KEYS.keywords,'關鍵字群組科目','Keyword class')}</option>
      </optgroup>:null}
      {types.includes('place')?<optgroup label="地點"><option value="place">地點</option></optgroup>:null}
    </select>
  </label>;
}

function ScopeStatisticsResults({scopeId,navigation,types}){
  const UI_COPY=useUiCopy();
  const t=useUiText();
  const router=useRouter();
  const reduceMotion=useReducedMotion();
  const requested=String(navigation.rankingType||'');
  const rankingType=types.includes(requested)?requested:
    (['media_type','media_platform','media_style','media'].includes(requested)||navigation.statTab==='media'
      ?'source':['keywords','styles'].includes(navigation.statTab)?'keywords':types[0]||'');
  // Total remains the light landing. Other dimensions are independent,
  // selected-only scoped reads; never reinterpret Media/Place as Keywords.
  const keywordDimension=rankingType==='keywords';
  const categoryChart=rankingType==='place';
  const deviceTimeUnit=useDefaultTimeUnit();
  const defaultTimeUnit=deviceTimeUnit;
  const [chartIntent,setChartIntent]=useState('auto');
  const [zoomLevel,setZoomLevel]=useState(0);
  const [foldBlank,setFoldBlank]=useState(true);
  // Leave potentially expensive keyword aggregation OFF until explicitly chosen.
  const [selectedKeywordClassUid,setSelectedKeywordClassUid]=useState('');
  const [sourceGroup,setSourceGroup]=useState(String(navigation.source||''));
  const [categoryChoice,setCategoryChoice]=useState('');
  const [linkedPeriod,setLinkedPeriod]=useState(null);
  useEffect(()=>{
    setSelectedKeywordClassUid('');
    setSourceGroup(requested==='source'?String(navigation.source||''):'');
    setCategoryChoice('');
    setLinkedPeriod(null);
    setChartIntent('auto');
  },[scopeId,navigation.statTab,requested,navigation.source]);
  // The current full calendar year is the initial Statistics window, even when
  // Era records exist. A saved Era is selected only by an explicit UI action.
  const [selectedPeriodKey,setSelectedPeriodKey]=useState('year');
  useEffect(()=>{setSelectedPeriodKey('year');},[scopeId]);
  const queryEndDate=useMemo(()=>taipeiDateKey(),[]);
  // The active route already resolves the requested Scope; no registry-wide SELECT.
  const targetScopes=useMemo(()=>[defaultScopeData(scopeId)].filter(Boolean),[scopeId]);
  const resourceCache=useResourceCache();
  // The earliest date only widens the zoom-out limit. It arrives with the chart data
  // itself, so the first window never waits for it.
  const [knownEarliest,setKnownEarliest]=useState('');
  const customQueryRange=useMemo(()=>statisticsZoomWindow(zoomLevel,queryEndDate,knownEarliest),
    [zoomLevel,queryEndDate,knownEarliest]);
  const periodQuery=useAsyncResource({
    queryKey:['culture-time-periods',scopeId],
    // Load the small Era index before the native select receives focus.
    // Updating React state inside onFocus can close a browser's open select.
    enabled:scopeId!=='local'&&scopeId!=='loc'&&Boolean(targetScopes[0]),
    queryFn:async()=>{
      // Period lucus remain on the independently working direct reader.
      // ISR never becomes a required path when an endpoint is not available.
      const {selectScopeCultureEraIndex}=await import('../../loc/culture/query');
      return selectScopeCultureEraIndex(scopeId);
    },
    revalidateOnFocus:false,
    revalidateOnReconnect:false
  });
  const periods=useMemo(()=>(periodQuery.data||[])
    .filter(row=>String(row.scope_id||'')===scopeId&&row.start_date)
    .sort((a,b)=>String(a.start_date).localeCompare(String(b.start_date))
      ||Number(a.order||0)-Number(b.order||0)),[periodQuery.data,scopeId]);
  const selectedPeriod=selectedPeriodKey==='latest'
    ?periods.at(-1)||null
    :periods.find(row=>String(row.period||row.era_id||row.uid)===selectedPeriodKey)||null;
  // LOC aggregates member Scopes, but has no mandatory aggregate Period row.
  // An empty or non-period Scope must not request a nonexistent Period index.
  const requestedStart=dateKey(navigation.from),requestedEnd=dateKey(navigation.to);
  const hasRequestedWindow=Boolean(requestedStart&&requestedEnd&&requestedStart<=requestedEnd);
  const periodNavigationReady=hasRequestedWindow||selectedPeriodKey==='year'||scopeId==='local'||scopeId==='loc'||periodQuery.data!==undefined||Boolean(periodQuery.error);
  const queryRange=useMemo(()=>{
    if(hasRequestedWindow){
      const days=Math.round((Date.parse(requestedEnd+'T00:00:00Z')-Date.parse(requestedStart+'T00:00:00Z'))/86_400_000);
      return {...customQueryRange,startDate:requestedStart,endDate:requestedEnd,
        bucket:defaultTimeUnit==='auto'?(days>180?'month':days>31?'week':'day'):defaultTimeUnit,
        fullHistory:false,canZoomOut:false,canZoomIn:false};
    }
    if(selectedPeriodKey==='year')return {...customQueryRange,
      startDate:DEFAULT_YEAR_WINDOW.startDate,endDate:DEFAULT_YEAR_WINDOW.endDate,
      bucket:defaultTimeUnit==='auto'?'month':defaultTimeUnit,
      fullHistory:false,canZoomOut:false,canZoomIn:false};
    if(!selectedPeriod)return defaultTimeUnit==='auto'?customQueryRange:{...customQueryRange,bucket:defaultTimeUnit};
    const startDate=String(selectedPeriod.start_date).slice(0,10);
    const endDate=String(selectedPeriod.end_date||queryEndDate).slice(0,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(startDate)||!/^\d{4}-\d{2}-\d{2}$/.test(endDate)||startDate>endDate)return customQueryRange;
    const days=Math.round((Date.parse(endDate+'T00:00:00Z')-Date.parse(startDate+'T00:00:00Z'))/86_400_000);
    return {...customQueryRange,startDate,endDate,
      bucket:defaultTimeUnit==='auto'?(days>180?'month':days>31?'week':'day'):defaultTimeUnit,
      fullHistory:false,canZoomOut:false,canZoomIn:false};
  },[selectedPeriodKey,selectedPeriod,customQueryRange,queryEndDate,hasRequestedWindow,
    requestedStart,requestedEnd,defaultTimeUnit]);
  // Both editors store flat names. Show one direct source choice, not a group tree.
  const activeSourceSelection=rankingType==='source'?sourceGroup:'';
  const totalChart=rankingType==='total'&&Boolean(targetScopes.length);
  const sourceChart=rankingType==='source'&&Boolean(targetScopes.length);
  const placeChart=categoryChart&&Boolean(targetScopes.length);
  // The Statistics landing begins with grouped daily totals only. Source taxonomy
  // and category counts load after a user selects a period for cross-analysis.
  const observedEnd=queryRange.endDate<queryEndDate?queryRange.endDate:queryEndDate;
  const observedSourceEnd=queryRange.endDate<queryEndDate?queryRange.endDate:queryEndDate;
  const totalDaily=useAsyncResource({
    queryKey:['statistics-total-daily-v1',scopeId,queryRange.startDate,observedEnd],
    enabled:totalChart&&periodNavigationReady&&Boolean(queryRange.startDate&&observedEnd&&queryRange.startDate<=observedEnd),
    queryFn:async({signal})=>{
      signal?.throwIfAborted?.();
      const {queryStaticsContent}=await import('../../loc/actions/statics/queries.mjs');
      const params=new URLSearchParams({kind:'daily_total',scope:scopeId,
        start:queryRange.startDate,end:observedEnd});
      const {data}=await queryStaticsContent(params.toString());
      signal?.throwIfAborted?.();
      return data;
    },
    revalidateOnFocus:false,revalidateOnReconnect:false
  });
  const totalTrend=useMemo(()=>{
    if(!totalChart||!totalDaily.data)return [];
    const start=queryRange.startDate,limit=observedEnd;
    if(!start||!limit||start>limit)return [];
    const buckets=new Map();
    for(let cursor=new Date(start+'T00:00:00Z'),last=new Date(limit+'T00:00:00Z');
      cursor<=last;cursor.setUTCDate(cursor.getUTCDate()+1)){
      const slot=trendBucket(cursor.toISOString().slice(0,10),queryRange.bucket);
      if(slot&&!buckets.has(slot.key))buckets.set(slot.key,{
        period:slot.label,total:0,
        start_date:slot.start,end_date:slot.end,
        partial:slot.start<start||slot.end>limit||slot.end>=queryEndDate
      });
    }
    for(const row of totalDaily.data.rows||[]){
      const slot=trendBucket(row.day,queryRange.bucket);
      const entry=slot&&buckets.get(slot.key);
      if(entry)entry.total+=Math.max(0,Number(row.item_count)||0);
    }
    return [...buckets.values()];
  },[totalChart,totalDaily.data,queryRange.startDate,observedEnd,
    queryRange.bucket,queryEndDate]);
  // ONE request per source chart: earliest date + exact daily counts + source taxonomy.
  const overview=useAsyncResource({
    queryKey:['scope-overview',scopeId,queryRange.startDate,observedSourceEnd],
    enabled:sourceChart&&periodNavigationReady&&Boolean(queryRange.startDate&&observedSourceEnd&&queryRange.startDate<=observedSourceEnd),
    queryFn:async({signal})=>{
      const {selectScopeOverview}=await loadGalaxyStatistics();
      const data=await selectScopeOverview(targetScopes[0],{...queryRange,endDate:observedSourceEnd,signal});
      if(signal.aborted)return data;
      // The self-intersection panel reads the same rows; seed its cache so opening it is free.
      resourceCache.set(['own-scope-source-intersection',scopeId,queryRange.startDate,queryRange.endDate],data.rows);
      return data;
    },
  });
  const linkedSourceOverview=useAsyncResource({
    queryKey:['statistics-linked-source-overview',scopeId,linkedPeriod?.startDate,linkedPeriod?.endDate],
    enabled:totalChart&&Boolean(linkedPeriod&&targetScopes[0]),
    queryFn:async({signal})=>{
      signal?.throwIfAborted?.();
      const {selectScopeOverview}=await loadGalaxyStatistics();
      const data=await selectScopeOverview(targetScopes[0],{
        startDate:linkedPeriod.startDate,endDate:linkedPeriod.endDate,signal
      });
      signal?.throwIfAborted?.();
      return data;
    },
    revalidateOnFocus:false,revalidateOnReconnect:false
  });
  useEffect(()=>{
    const first=(totalChart?totalDaily.data?.earliest:overview.data?.earliest)||'';
    if(first&&first!==knownEarliest)setKnownEarliest(first);
  },[overview.data,totalDaily.data,totalChart,knownEarliest]);
  const sourceRows={isPending:overview.isPending&&sourceChart,isSuccess:overview.isSuccess,error:overview.error,
    data:overview.data?.rows,dataUpdatedAt:overview.dataUpdatedAt};
  const categoryDaily=useAsyncResource({
    queryKey:['statistics-category-daily',scopeId,rankingType,queryRange.startDate,observedEnd],
    enabled:placeChart&&periodNavigationReady&&Boolean(queryRange.startDate&&observedEnd&&queryRange.startDate<=observedEnd),
    queryFn:async({signal})=>{
      signal?.throwIfAborted?.();
      const {queryTrace}=await import('../../loc/actions/trace/queries.mjs');
      const {data}=await queryTrace({
        p_scope_id:scopeId,p_view:'trace_places',
        p_start:queryRange.startDate,p_end:observedEnd,
        // Statistics' place view must satisfy both independent feature flags.
        // Ordinary Trace views keep their own trace-only read semantics.
        p_options:{statisticsOnly:true}
      });
      signal?.throwIfAborted?.();
      if(!Array.isArray(data))throw new Error('Invalid place statistics');
      return data;
    },
    revalidateOnFocus:false,revalidateOnReconnect:false
  });
  // One public model read of the existing 30 LocLucus source nodes.
  // The native provider uses the fixed ZenStack LocLucus model. Do not fall
  // back to a local source list, a hardcoded category snapshot or media tree.
  const sourceTaxonomyQuery=useAsyncResource({
    queryKey:['loc-zmodel-source-taxonomy'],
    enabled:sourceChart||(totalChart&&Boolean(linkedPeriod)),
    queryFn:async()=>{
      const {readPublicSourceTaxonomy}=await import('../../loc/source/catalog-public.mjs');
      return readPublicSourceTaxonomy();
    },
    revalidateOnFocus:false,revalidateOnReconnect:false
  });
  const sourceCatalog={
    isPending:sourceTaxonomyQuery.isPending&&(sourceChart||(totalChart&&Boolean(linkedPeriod))),
    isSuccess:sourceTaxonomyQuery.isSuccess,
    error:sourceTaxonomyQuery.error,
    data:sourceTaxonomyQuery.data,
    dataUpdatedAt:sourceTaxonomyQuery.dataUpdatedAt
  };
  const linkedSourceBreakdown=useMemo(()=>{
    if(!linkedPeriod||!sourceCatalog.isSuccess||!linkedSourceOverview.data)return null;
    return administrativeSourceTrend(linkedSourceOverview.data.rows||[],sourceCatalog.data||{}, {
      startDate:linkedPeriod.startDate,endDate:linkedPeriod.endDate,unit:'day'
    });
  },[linkedPeriod,sourceCatalog.isSuccess,sourceCatalog.data,linkedSourceOverview.data]);
  const linkedSourceDistribution=useMemo(()=>linkedSourceBreakdown
    ?linkedSourceBreakdown.distribution.map((row,index)=>({
      key:String(linkedSourceBreakdown.series[index]?.key||'').replace(/^category_/,''),
      name:row.name,value:row.value
    }))
    :[],[linkedSourceBreakdown]);
  // Numeric counts use the existing scoped database query. Category bucketing
  // is tiny synchronous presentation work, not an independent remote resource:
  // avoid a second loading cycle after the numeric response arrives.
  const adminSource=useMemo(()=>{
    if(!sourceChart||!sourceCatalog.isSuccess)return null;
    return administrativeSourceTrend(overview.data?.rows||[],sourceCatalog.data||{},{
      startDate:queryRange.startDate,endDate:observedSourceEnd,
      unit:queryRange.bucket,sourceCategory:activeSourceSelection
    });
  },[sourceChart,sourceCatalog.isSuccess,sourceCatalog.data,overview.data,
    queryRange.startDate,observedSourceEnd,queryRange.bucket,activeSourceSelection]);
  const adminSourceReady=Boolean(adminSource);
  const resolvedAdminSource=adminSource||{rows:[],series:[],distribution:[],total:0};
  // Place is a separate geographical dimension. All multimedia platforms
  // are already represented in the unified Galaxy.site source taxonomy.
  const categoryWindow=useMemo(()=>rowsInWindow(categoryDaily.data||[],{
    ...queryRange,endDate:observedEnd
  }),[categoryDaily.data,queryRange.startDate,observedEnd,queryRange.bucket]);
  const categoryCatalog=useMemo(()=>facetTotals(categoryWindow.rows),[categoryWindow.rows]);
  const selectedCategory=categoryCatalog.find(row=>row.term===categoryChoice);
  const displayedCategories=useMemo(()=>selectedCategory?[selectedCategory.term]:
    categoryCatalog.slice(0,12).map(row=>row.term),
    [categoryCatalog,selectedCategory,rankingType]);
  const categoryTrend=useMemo(()=>facetTrend(categoryWindow.rows,categoryWindow,displayedCategories),
    [categoryWindow.rows,categoryWindow.startDate,categoryWindow.endDate,categoryWindow.bucket,displayedCategories]);
  const categorySeries=useMemo(()=>displayedCategories.map((term,index)=>({
    key:'category_'+index,label:term
  })),[displayedCategories,rankingType]);
  const categoryDistribution=useMemo(()=>displayedCategories.map(term=>({
    key:term,name:term,
    value:categoryCatalog.find(row=>row.term===term)?.item_count||0
  })),[displayedCategories,categoryCatalog,rankingType]);
  const basicTrend=totalChart?totalTrend:placeChart?categoryTrend:resolvedAdminSource.rows;
  const chartTrend=basicTrend;
  const onSelectChartPeriod=row=>{
    const startDate=dateKey(row?.start_date);
    const rawEnd=dateKey(row?.end_date||row?.start_date);
    const endDate=rawEnd>queryEndDate?queryEndDate:rawEnd;
    if(!startDate||!endDate||startDate>endDate)return;
    const period=String(row?.period||'');
    setLinkedPeriod(current=>current?.period===period?null:{
      startDate,endDate,period,label:period||startDate
    });
  };
  const basicSeries=totalChart?[]:placeChart?categorySeries:resolvedAdminSource.series;
  const basicDistribution=totalChart?[]:placeChart?categoryDistribution:resolvedAdminSource.distribution;
  const insightRows=useMemo(()=>chartTrend.map(row=>({
    period:row.period,
    total:sourceChart?Number(row.total)||0:basicSeries.reduce((sum,field)=>sum+(Number(row[field.key])||0),0),
    start_date:row.start_date,end_date:row.end_date,
    partial:Boolean(row.end_date&&dateKey(row.end_date)>=queryEndDate)
  })),[chartTrend,sourceChart,basicSeries,queryEndDate]);
  // The same source breakdown drives the KPI and the connected Recharts view.
  // Do not rescan Galaxy or request one aggregate per individual category.
  const sourceSummary={total:resolvedAdminSource.total,
    sources:resolvedAdminSource.distribution,
    startDate:queryRange.startDate,endDate:observedSourceEnd,
  };
  const sourceCategoryDistribution=useMemo(()=>{
    if(!sourceChart)return [];
    const start=linkedPeriod?.startDate||queryRange.startDate;
    const end=linkedPeriod?.endDate||observedSourceEnd;
    const catalog=sourceCatalog.data||{};
    const labels=new Map((catalog.categories||[]).map(row=>[
      String(row.category_code||''),String(row.display_name||row.category_code||'')
    ]));
    labels.set('others','未分類');
    const totals=new Map();
    for(const row of sourceRows.data||[]){
      if(row.kind!=='source')continue;
      const day=dateKey(row.day);
      if(!day||day<start||day>end)continue;
      const category=String(assignedSource(row.category,catalog.aliases||[],catalog.categories||[])||'others');
      totals.set(category,(totals.get(category)||0)+Math.max(0,Number(row.item_count)||0));
    }
    return [...totals].map(([key,value])=>({
      key,name:labels.get(key)||'未分類',value
    })).filter(row=>row.value>0)
      .sort((a,b)=>b.value-a.value||a.name.localeCompare(b.name)).slice(0,12);
  },[sourceChart,linkedPeriod,queryRange.startDate,observedSourceEnd,sourceCatalog.data,sourceRows.data]);
  const activeSourceCategoryKeys=useMemo(()=>{
    if(!activeSourceSelection)return [];
    if(activeSourceSelection==='others')return ['others'];
    const descendants=(sourceCatalog.data?.tree||[])
      .filter(row=>Array.isArray(row.path)&&row.path.includes(activeSourceSelection))
      .map(row=>String(row.uid||''));
    return [activeSourceSelection,...descendants];
  },[activeSourceSelection,sourceCatalog.data]);
  const placeDistribution=useMemo(()=>{
    if(!placeChart)return [];
    const start=linkedPeriod?.startDate||queryRange.startDate;
    const end=linkedPeriod?.endDate||queryRange.endDate;
    const rows=linkedPeriod?rowsInWindow(categoryWindow.rows,{
      startDate:start,endDate:end,bucket:queryRange.bucket
    }).rows:categoryWindow.rows;
    const totals=facetTotals(rows);
    return totals.slice(0,12).map(row=>({key:row.term,name:row.term,value:row.item_count}));
  },[placeChart,linkedPeriod,queryRange.startDate,queryRange.endDate,queryRange.bucket,categoryWindow.rows]);
  const categorySummary={
    total:categoryCatalog.reduce((sum,row)=>sum+Number(row.item_count||0),0),
    sources:displayedCategories.map(term=>({
      term,
      item_count:categoryCatalog.find(row=>row.term===term)?.item_count||0
    })),
    startDate:queryRange.startDate,endDate:observedEnd
  };
  const displaySummary=placeChart?categorySummary:sourceSummary;
  const sourceIntentDistribution=useMemo(()=>basicDistribution.map((row,index)=>({
    key:String(basicSeries[index]?.key||'').replace(/^category_/,'')||String(row.name||row.term||''),
    name:String(row.name||row.term||''),
    value:Number(row.value??row.item_count)||0
  })).filter(row=>row.name&&row.value>0),[basicDistribution,basicSeries]);
  const intentDistribution=sourceChart
    ?(linkedPeriod?sourceCategoryDistribution:sourceIntentDistribution):placeDistribution;
  const intentOptions=useMemo(()=>availableStatisticIntents({
    rows:chartTrend,series:basicSeries,distribution:intentDistribution,
    values:totalChart?chartTrend.filter(row=>!row.partial).map(row=>({
      uid:row.period,label:row.period,period:row.period,
      start_date:row.start_date,end_date:row.end_date,value:Number(row.total)||0
    })):[],
    totalKey:totalChart?'total':'',
    mutuallyExclusive:sourceChart,seriesExclusive:sourceChart
  }),[chartTrend,basicSeries,intentDistribution,totalChart,sourceChart]);
  const defaultChartIntent=sourceChart&&intentOptions.includes('compositionTrend')
    ?'compositionTrend':'trend';
  const effectiveIntent=intentOptions.includes(chartIntent)?chartIntent:defaultChartIntent;
  const distributionIntent=['compare','composition','ranking'].includes(effectiveIntent);
  const mainChartRows=distributionIntent?[]:chartTrend;
  const mainChartSeries=distributionIntent?[]:basicSeries;
  const mainChartDistribution=distributionIntent?intentDistribution:[];
  const selectSourceCategory=key=>{
    const code=String(key||'').replace(/^category_/,'');
    if(!code)return;
    setSourceGroup(current=>current===code?'':code);
    setChartIntent('trend');
  };
  const selectPlaceCategory=key=>{
    const term=String(key||'').trim();
    if(!term)return;
    setCategoryChoice(current=>current===term?'':term);
    setChartIntent('trend');
  };
  const selectChartSeries=key=>{
    if(sourceChart)selectSourceCategory(key);
    else if(placeChart){
      const term=basicSeries.find(field=>field.key===key)?.label;
      if(term)selectPlaceCategory(term);
    }
  };
  const styleRange=useMemo(()=>({
    startDate:queryRange.startDate||'',
    endDate:queryRange.endDate||''
  }),[queryRange.startDate,queryRange.endDate]);
  // Separate the guest/shared directory from the owner's private catalog.
  // Never reuse a one-Class anonymous cache after an authorized sign-in.
  const keywordAccount=usePassiveSessionAccount();
  const keywordClassQuery=useAsyncResource({
    queryKey:['scope-active-keyword-class-name',scopeId,keywordAccount.user?.id||'guest'],
    // The keyword class is optional; the ordinary Statistics view never queries it.
    enabled:keywordDimension,
    queryFn:async()=>{
      const {selectAvailableKeywordClasses}=await import('../../loc/keywords/analysis');
      return selectAvailableKeywordClasses(scopeId);
    },
  });
  const availableKeywordClasses=keywordClassQuery.data?.classes||[];
  // All visible Classes may be selected by UID; never infer a Class by its name.
  const scopedKeywordClasses=availableKeywordClasses;
  const selectedKeywordClass=scopedKeywordClasses.find(item=>item.classUid===selectedKeywordClassUid)
    ||scopedKeywordClasses.find(item=>item.classUid===keywordClassQuery.data?.currentClassUid)
    ||scopedKeywordClasses[0];
  const resolvedKeywordClassUid=String(selectedKeywordClass?.classUid||'');
  const runeQuery=useAsyncResource({
    queryKey:['statistics-keyword-class',scopeId,resolvedKeywordClassUid,styleRange.startDate,styleRange.endDate],
    queryFn:async()=>{
      const {selectKeywordAnalysisSummary}=await import('../../loc/keywords/analysis');
      return selectKeywordAnalysisSummary({
        scopeId,classUid:resolvedKeywordClassUid,...styleRange
      });
    },
    enabled:keywordDimension&&periodNavigationReady&&Boolean(resolvedKeywordClassUid)
      &&Boolean(styleRange.startDate&&styleRange.endDate),
  });

  const showTotalOverview=totalChart&&!totalDaily.isPending&&!totalDaily.error&&Boolean(totalDaily.data);
  const categoryPending=sourceChart?(sourceRows.isPending||sourceCatalog.isPending||!adminSourceReady):categoryDaily.isPending;
  const categoryError=sourceChart?(sourceRows.error||sourceCatalog.error):categoryDaily.error;
  const showCategoryOverview=(sourceChart||placeChart)&&!categoryPending&&!categoryError
    &&(sourceChart?adminSourceReady:Boolean(categoryDaily.data));
  return <section className="scope-stat-section statistics-dashboard">
    <div className={'scope-stat-controls statistics-dashboard__filters'+
      (showTotalOverview?' statistics-dashboard__filters--summary':'')}>
      <div className="statistics-dashboard__filter-fields">
      <StatisticTypeSelect scopeId={scopeId} navigation={navigation} types={types}/>
      {placeChart?<label>
        <span>地點</span>
        <select className="scope-select" aria-label="地點"
          value={selectedCategory?.term||''} onChange={event=>setCategoryChoice(event.target.value)}>
          <option value="">常見地點</option>
          {categoryCatalog.map(row=><option key={row.term} value={row.term}>
            {row.term}
          </option>)}
        </select>
      </label>:null}
      {keywordDimension?<label>
        <span>關鍵詞組（Class）</span>
        <select className="scope-select" aria-label="關鍵字群組" value={resolvedKeywordClassUid}
          disabled={keywordClassQuery.isPending||!scopedKeywordClasses.length}
          onChange={event=>setSelectedKeywordClassUid(event.target.value)}>
          {!scopedKeywordClasses.length?<option value="">沒有可存取的對應關鍵詞分類</option>:null}
          {scopedKeywordClasses.map(item=><option key={item.classUid} value={item.classUid}>
            {[item.categoryName,item.name].filter(Boolean).join('／')}
          </option>)}
        </select>
      </label>:null}
      {keywordClassQuery.error?<p className="scope-status scope-error" role="status">
        關鍵詞組讀取失敗：{featureDataErrorMessage(keywordClassQuery.error,UI_COPY)}
      </p>:null}
      <label>
        <span>時期</span>
        <select className="scope-select" aria-label="時期" value={selectedPeriodKey}
          onChange={event=>{
            prepareTransientResourceAction('period',{queryKeys:[
              ['statistics-total-daily-v1',scopeId],['scope-overview',scopeId],
              ['statistics-keyword-class',scopeId]
            ]});
            setSelectedPeriodKey(event.target.value);setLinkedPeriod(null);
          }}>
          <option value="year">{DEFAULT_YEAR_WINDOW.label}</option>
          <option value="latest">最新時期</option>
          <option value="">自選時間（原有縮放）</option>
          {periodQuery.isPending?<option disabled value="__loading">正在載入時期…</option>:null}
          {periods.map(period=><option key={period.uid||period.period} value={String(period.period||period.era_id||period.uid)}>
            {period.title||period.name||period.period}
          </option>)}
        </select>
      </label>
      {rankingType==='source'?<label>
        <span>來源分類</span>
        <select className="scope-select" aria-label="來源分類" value={activeSourceSelection}
          onChange={event=>setSourceGroup(event.target.value)}>
          <option value="">全部來源</option>
          {groupedSourceOutline(sourceCatalog.data).map(group=>
            <optgroup key={group.key} label={group.label}>
              {group.items.map(source=><option key={source.code} value={source.code}>
                {'　'.repeat(source.orphanType
                  ?Math.max(0,source.level-['universe','galaxy','domain','from'].indexOf(source.orphanType))
                  :source.level)}{source.label}
              </option>)}
            </optgroup>)}
          <option value="others">未分類</option>
        </select>
      </label>:null}
      {periodQuery.error?<span className="scope-status scope-error">
        時期範圍無法載入，仍可使用自選時間：{featureDataErrorMessage(periodQuery.error,UI_COPY)}
      </span>:null}
      {(totalChart||sourceChart||placeChart)&&intentOptions.length>1?<><label>
        <span>分析意圖</span>
        <select className="scope-select" value={effectiveIntent} onChange={event=>{
          prepareTransientResourceAction('chart');
          setChartIntent(event.target.value);
        }}>
          {intentOptions.map(value=><option key={value} value={value}>
            {STATISTIC_INTENTS.find(([id])=>id===value)?.[1]||value}
          </option>)}
        </select>
      </label>
      {!distributionIntent?<label className="scope-setting-toggle">
        <input type="checkbox" checked={foldBlank} onChange={event=>setFoldBlank(event.target.checked)}/> <UiText id="uiExtra.statisticsView.foldBlank"/>
      </label>:null}
      </>:null}
      </div>
      {showTotalOverview?<StatisticsDashboardKpis label="作品總數" items={[
        {key:'records',label:'作品總數',value:chartTrend
          .reduce((sum,row)=>sum+Number(row.total||0),0).toLocaleString()},
        {key:'active',label:'活躍時段',value:chartTrend
          .filter(row=>Number(row.total)>0).length.toLocaleString()},
        {key:'completed',label:'完整觀察時段',value:chartTrend
          .filter(row=>!row.partial).length.toLocaleString()}
      ]}/>:null}
    </div>
    <>
    {/* Total statistics stay lightweight until a selected period asks for its
        related source distribution. Category analysis uses the same Dashboard. */}
    {totalChart&&totalDaily.isPending?<div className="loc-progressive-chart-frame" role="status" aria-busy="true">
      <span>正在統計作品總數… <ActivityMotion kind="numbers"/></span>
      <div className="loc-progressive-chart-axis" aria-hidden="true"/>
      <small>{queryRange.startDate} ～ {queryRange.endDate}</small>
    </div>:null}
    {totalChart&&totalDaily.error?<p className="scope-status scope-error" role="alert">
      {featureDataErrorMessage(totalDaily.error,UI_COPY)}
    </p>:null}
    {showTotalOverview? <>
      <StatisticsInsightsPanel rows={chartTrend} range={queryRange} intent={effectiveIntent}
        zoomLevel={zoomLevel} onZoomLevelChange={setZoomLevel}
        idPrefix="scope-stat" showMethodologyNote={scopeId!=='lo3rwang'}
        onPeriodClick={onSelectChartPeriod} selectedPeriodKey={linkedPeriod?.period}
        relatedContent={linkedPeriod?<motion.section className="statistics-dashboard__linked-source-panel"
          role="region" aria-label="所選時間的來源分類"
          initial={reduceMotion?false:{opacity:0,y:10,scale:.985}}
          animate={{opacity:1,y:0,scale:1}}
          transition={{duration:reduceMotion?0:.24,ease:'easeOut'}}>
          <header className="statistics-dashboard__panel-heading">
            <h3>{linkedPeriod.label} · 來源分布</h3>
            <button type="button" className="loc-button loc-button--small"
              onClick={()=>setLinkedPeriod(null)}>清除連動</button>
          </header>
          <p className="scope-status">點選來源分類，會開啟該分類的時間分析。</p>
          {linkedSourceOverview.isPending||sourceCatalog.isPending
            ?<p className="scope-status" role="status" aria-busy="true">
              正在整理這段時間的來源分類… <ActivityMotion kind="numbers"/>
            </p>:null}
          {linkedSourceOverview.error||sourceCatalog.error
            ?<p className="scope-status scope-error" role="alert">
              {featureDataErrorMessage(linkedSourceOverview.error||sourceCatalog.error,UI_COPY)}
            </p>:null}
          {!linkedSourceOverview.isPending&&!sourceCatalog.isPending
            &&!linkedSourceOverview.error&&!sourceCatalog.error
            ?linkedSourceDistribution.length?<StatisticsMultiChart intent="composition"
              mutuallyExclusive distribution={linkedSourceDistribution}
              height={Math.max(280,Math.min(12,linkedSourceDistribution.length)*34+70)}
              onCategoryClick={key=>router.push(featureNavigationHref(scopeId,'statics',{
                ...navigation,rankingType:'source',source:String(key||''),
                from:linkedPeriod.startDate,to:linkedPeriod.endDate
              }))}/>
              :<p className="scope-status">這段時間沒有可顯示的來源分類。</p>:null}
        </motion.section>:null}/>
    </>:null}
    {(sourceChart||placeChart)&&categoryPending&&!categoryError?<div className="scope-stat-data-pending loc-progressive-chart-frame">
      <p className="scope-status" role="status">{sourceChart&&overview.data&&!sourceCatalog.isSuccess?
        '原始來源筆數已取得：'+(overview.data.rows||[]).filter(row=>row.kind==='source').reduce((n,row)=>n+Number(row.item_count||0),0).toLocaleString()+' 篇；正在整理來源分類…':
        '統計中請稍後'} <ActivityMotion kind="numbers"/></p>
      <div className="loc-progressive-chart-axis" aria-hidden="true"/>
      <small>{queryRange.startDate} ～ {queryRange.endDate}</small>
    </div>:null}
    {(sourceChart||placeChart)&&categoryError?<p className="scope-status scope-error">{featureDataErrorMessage(categoryError,UI_COPY)}</p>:null}
    {showCategoryOverview?<>
      <StatisticsDashboardKpis label={t('uiExtra.statisticsView.dashboardTitle')} items={[
        {key:'records',label:t('uiExtra.statisticsView.dashboardRecords'),value:displaySummary.total.toLocaleString()},
        {key:'categories',label:t('uiExtra.statisticsView.dashboardCategoryCount'),value:(placeChart?categoryCatalog.length:displaySummary.sources.length).toLocaleString()},
        {key:'active',label:t('uiExtra.statisticsView.dashboardActiveBuckets'),
          value:chartTrend.filter(row=>(placeChart
            ?basicSeries.reduce((sum,field)=>sum+(Number(row[field.key])||0),0)
            :Number(row.total))>0).length.toLocaleString()}
      ]}/>
      <div className="statistics-dashboard__workspace">
        <section className="statistics-dashboard__panel statistics-dashboard__panel--chart" aria-label={t('uiExtra.statisticsView.dashboardTrendTitle')}>
          <header className="statistics-dashboard__panel-heading">
            <h3>{t('uiExtra.statisticsView.dashboardTrendTitle')}</h3>
            <p>{displaySummary.startDate&&displaySummary.endDate?displaySummary.startDate+' ～ '+displaySummary.endDate:''}</p>
          </header>
          <StatisticsChartFrame level={zoomLevel} onChange={setZoomLevel} range={queryRange} idPrefix="scope-stat">
            <StatisticsMultiChart key={rankingType+':'+effectiveIntent} intent={effectiveIntent}
              rows={mainChartRows} series={mainChartSeries} distribution={mainChartDistribution}
              mutuallyExclusive={sourceChart} seriesExclusive={sourceChart}
              totalKey={rankingType==='total'?'total':''}
              foldBlank={foldBlank} height={420}
              onPeriodClick={distributionIntent?null:onSelectChartPeriod}
              onCategoryClick={distributionIntent
                ?(key=>sourceChart?selectSourceCategory(key):selectPlaceCategory(key)):null}
              onSeriesClick={!distributionIntent?selectChartSeries:null}
              activeCategoryKey={sourceChart?activeSourceCategoryKeys:selectedCategory?.term||''}
              selectedPeriodKey={linkedPeriod?.period}/>
          </StatisticsChartFrame>
        </section>
        <div className="statistics-dashboard__analysis-stack">
          {!distributionIntent?<section className="statistics-dashboard__panel statistics-dashboard__panel--distribution"
            aria-label={t('uiExtra.statisticsView.dashboardDistributionTitle')}>
            <header className="statistics-dashboard__panel-heading">
              <h3>{placeChart?'地點分布':t('uiExtra.statisticsView.dashboardDistributionTitle')}</h3>
            </header>
            <p className="scope-status">{linkedPeriod
              ?'已選 '+linkedPeriod.label+'；點選分類會同步更新左側趨勢。'
              :sourceChart?'點選時間點查看該期來源；再點來源分類，左側會切換成該分類趨勢。'
                :'點選時間點查看該期地點分布；再點地點，左側會切換成該地點趨勢。'}
              {linkedPeriod?<button type="button" className="loc-button loc-button--small"
                onClick={()=>setLinkedPeriod(null)}>顯示完整區間</button>:null}
            </p>
            {sourceChart?sourceCategoryDistribution.length?<StatisticsMultiChart
              key={'source-related:'+linkedPeriod?.startDate+':'+linkedPeriod?.endDate}
              intent="composition" mutuallyExclusive height={Math.max(280,Math.min(12,sourceCategoryDistribution.length)*34+75)}
              distribution={sourceCategoryDistribution} activeCategoryKey={activeSourceCategoryKeys}
              onCategoryClick={key=>setSourceGroup(current=>current===String(key||'')?'':String(key||''))}/>
              :<p className="scope-status">{t('uiExtra.statisticsView.dashboardEmpty')}</p>
              :placeDistribution.length?<StatisticsMultiChart intent="ranking"
                height={Math.max(280,Math.min(12,placeDistribution.length)*34+75)}
                distribution={placeDistribution} activeCategoryKey={selectedCategory?.term||''}
                onCategoryClick={key=>setCategoryChoice(current=>current===String(key||'')?'':String(key||''))}/>
                :<p className="scope-status">{t('uiExtra.statisticsView.dashboardEmpty')}</p>}
          </section>:<section className="statistics-dashboard__panel statistics-dashboard__panel--distribution"
            aria-label="分類連動提示">
            <header className="statistics-dashboard__panel-heading">
              <h3>{sourceChart?'來源比較':'地點比較'}</h3>
            </header>
            <p className="scope-status">點選圖表中的分類，切換至該分類的時間趨勢；再次選取可清除篩選。</p>
          </section>}
          <StatisticsInsightsRail rows={insightRows}
            title={sourceChart?'來源趨勢分析':'地點趨勢分析'}
            measureLabel={sourceChart?'來源作品':'地點作品'}
            showMethodologyNote={scopeId!=='lo3rwang'}
            methodologyNote={sourceChart
              ?'分析以來源分類的每日筆數計算，不載入文章本文。'
              :'分析以地點每日筆數計算，不載入文章本文。'}/>
        </div>
      </div>
    </>:null}
    {keywordDimension?<>
      {keywordClassQuery.isPending?<p className="scope-status">正在讀取關鍵詞組設定…</p>:null}
      {!keywordClassQuery.isPending&&!keywordClassQuery.error&&!scopedKeywordClasses.length?<p className="scope-status">目前沒有可查看的關鍵詞科目；請先建立或公開科目。</p>:null}
      {resolvedKeywordClassUid?<KeywordPatternSummary scopeId={scopeId} classUid={resolvedKeywordClassUid} range={styleRange}/>:null}
      {runeQuery.isPending?<p className="scope-status" role="status"><ActivityMotion kind="numbers"/> <UiText id="uiExtra.statisticsUI.loadingKeywordAttrs"/></p>:null}
      {runeQuery.error?<p className="scope-status scope-error">{featureDataErrorMessage(runeQuery.error)}</p>:null}
      {!runeQuery.isPending&&!runeQuery.error&&runeQuery.data?<Rune66Summary key={resolvedKeywordClassUid} analysis={runeQuery.data} range={queryRange} scopeId={scopeId}/>:null}
      {!runeQuery.isPending&&!runeQuery.error&&runeQuery.data&&!runeQuery.data.staticstime?<p className="scope-status">此 Class 的舊式統計尚未完成；已存詞級結果仍可在上方查看。</p>:null}
    </>:null}
    {sourceChart&&Boolean(targetScopes[0])?<StatisticsDetails
      summary={<UiText id="uiExtra.statisticsView.selfIntersectionTitle"/>}>
      {()=> <ScopeSelfIntersection
        key={scopeId}
        scope={targetScopes[0]}
        range={queryRange}
        classUid={resolvedKeywordClassUid}
        zoomLevel={zoomLevel}
        onZoomLevelChange={setZoomLevel}
        sharedCatalog={sourceCatalog}
      />}
    </StatisticsDetails>:null}
    </>
  </section>;
}

function ScopeStatisticsPanel({scopeId,navigation,types,canManageSources=false}){
  return <ScopeStatisticsResults scopeId={scopeId} navigation={navigation} types={types}/>;
}

function StatisticsPanel({scopeId,aggregateScopes=false,navigation,types,canManageSources=false}){
  const t=useUiText();
  // Cross-Scope statistical aggregation belongs to LOC only. Other Scope
  // Groups remain overview/navigation surfaces, never merged COUNT queries.
  if(aggregateScopes&&scopeId==='loc')return <ScopeGroupStatistics
    taipeiDateKey={taipeiDateKey}
    trendBucket={trendBucket}
    loadGalaxyStatistics={loadGalaxyStatistics}/>;
  if(aggregateScopes)return <ScopeGroupOverview
    scopeId={scopeId}
    featureId="statics"
    title={t('uiExtra.statisticsView.scopeGroupStatisticsTitle')}
    description={t('uiExtra.statisticsView.scopeGroupStatisticsHelp')}
  />;
  return <ScopeStatisticsPanel scopeId={scopeId} navigation={navigation} types={types} canManageSources={canManageSources}/>;
}

export default function Statistics(){
  useUiSection('statistics');
  useUiSection('uiExtra.statisticsUI');
  useUiSection('uiExtra.statisticsView');
  useUiSection('uiExtra.chartTypes');
  const {scopeId,scope}=useScopeRuntime();
  const searchParams=useSearchParams();
  const navigation=useMemo(()=>readFeatureNavigation(searchParams),[searchParams]);
  // The landing page is always total-only, including for existing users
  // whose retired personal statistics preference selected 'source'.
  const activeNavigation=navigation;
  return <FeaturePage featureId="statics">
    <section className="loc-card scope-feature-card">
      <StatisticsPanel
        scopeId={scopeId}
        aggregateScopes={Boolean(scope?.aggregateChildren)}
        navigation={activeNavigation}
        types={STAT_TYPES}
        canManageSources={false}
      />
    </section>
  </FeaturePage>;
}
