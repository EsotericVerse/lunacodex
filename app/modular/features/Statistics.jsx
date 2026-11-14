'use client';

import {registerDefaultSection} from '../../i18n/ui-copy';
import {useUiCopy,useUiSection} from '../../i18n/ui-locale';
import UiText,{useUiText} from '../../i18n/UiText';
import statisticsZh from '../../i18n/sections/statistics.zh_tw.js';
import statisticsUIZh from '../../i18n/sections/uiExtra.statisticsUI.zh_tw.js';
import statisticsViewZh from '../../i18n/sections/uiExtra.statisticsView.zh_tw.js';
import chartTypesZh from '../../i18n/sections/uiExtra.chartTypes.zh_tw.js';
registerDefaultSection('statistics',statisticsZh);
registerDefaultSection('uiExtra.statisticsUI',statisticsUIZh);
registerDefaultSection('uiExtra.statisticsView',statisticsViewZh);
registerDefaultSection('uiExtra.chartTypes',chartTypesZh);

import {useEffect,useMemo,useState} from 'react';
import useLocFeatureSettings from '../../loc/use-loc-feature-settings';
import dynamic from 'next/dynamic';
import {useRouter,useSearchParams} from 'next/navigation';
import {useAsyncResource,useResourceCache} from '../../../zenstack/client-queries';

// Defer Galaxy's data/query engine until the selected statistics mode needs it.
const loadGalaxyStatistics=()=>import('../../loc/galaxy-query');


import {defaultScopeData} from '../../loc/scope-data';
import {featureNavigationHref,readFeatureNavigation} from '../feature-navigation';
import {featureDataErrorMessage} from '../feature-data-state';
import {useScopeRuntime} from '../use-scope-runtime';
import useDefaultTimeUnit from '../../loc/use-default-time-unit';
import {FeaturePage} from '../ui';
import {assignedSource} from '../../loc/member-intersection-model.mjs';
import {sourceKeywordOptions} from '../../loc/source-keyword-options.mjs';
import {administrativeSourceTrend} from '../../loc/statistics-admin-source.mjs';
import {usePassiveSessionAccount} from '../../loc/use-account';
import {STAT_VISUAL_TYPES,semanticStatisticChartTypes,chartTypeGroups,preferredStatisticChartType} from '../modules/statistics/statistics-time-zoom.mjs';
const StatisticsMultiChart=dynamic(()=>import('../modules/statistics/StatisticsMultiChart'),{loading:()=>null});
const Rune66Summary=dynamic(()=>import('../modules/statistics/StatisticsMultiChart').then(m=>m.Rune66Summary),{loading:()=>null});
const KeywordPatternSummary=dynamic(()=>import('../modules/statistics/KeywordPatternSummary'),{loading:()=>null});
const ScopeSelfIntersection=dynamic(()=>import('../modules/statistics/ScopeSelfIntersection'),{loading:()=>null});
const ScopeGroupStatistics=dynamic(()=>import('../modules/statistics/ScopeGroupStatistics'),{loading:()=>null});
const ScopeGroupOverview=dynamic(()=>import('../../loc/ScopeGroupOverview'),{loading:()=>null});
const StatisticsInsightsPanel=dynamic(()=>import('../modules/statistics/StatisticsInsightsPanel'),{loading:()=>null});
import StatisticsChartFrame from '../modules/statistics/StatisticsChartFrame';
import StatisticsDetails from '../modules/statistics/StatisticsDetails';
import StatisticsDashboardKpis from '../modules/statistics/StatisticsDashboardKpis';
import ActivityMotion from '../ActivityMotion';
import {statisticsZoomWindow} from '../modules/statistics/statistics-time-zoom.mjs';
import {DEFAULT_YEAR_WINDOW} from '../../loc/default-year-window.mjs';

const CHART_TYPES=STAT_VISUAL_TYPES;
const STAT_TYPES=['total','keywords','source'];
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
  const categories=new Map(selectedCategories.map(value=>[String(value).normalize('NFKC').toLocaleLowerCase(),value]));
  const buckets=new Map();
  for(let cursor=new Date(window.startDate+'T00:00:00Z'),end=new Date(window.endDate+'T00:00:00Z');cursor<=end;cursor.setUTCDate(cursor.getUTCDate()+1)){
    const bucket=trendBucket(cursor.toISOString().slice(0,10),window.bucket);
    if(bucket&&!buckets.has(bucket.key))buckets.set(bucket.key,{period:bucket.label,_sort:bucket.key});
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
    const output={period:row.period};
    for(const category of selectedCategories)output[category]=Number(row[category])||0;
    return output;
  });
}

function StatisticTypeSelect({scopeId,navigation,types,selectedSource='',sourceTaxonomy=null}) {
  const UI_COPY=useUiCopy();
  const t=useUiText();
  const router=useRouter();
  // The Source group is a second selector family; it reuses the existing
  // Source chart and the same published Anchor labels as Culture.
  const sourceOptions=sourceKeywordOptions(sourceTaxonomy);
  const requested=String(navigation.rankingType||'');
  const selected=sourceOptions.find(item=>item.code===selectedSource);
  const active=types.includes(requested)
    ?requested==='source'&&selected?'source:'+selected.code:requested
    :(types[0]||'');
  if(!types.length)return null;
  return <label>
    <span>{UI_COPY.statistics.item}</span>
    <select id="statistics-ranking-type" className="scope-select" value={active} onChange={event=>{
      const value=event.target.value;
      if(!value||value===active)return;
      const choice=sourceOptions.find(item=>'source:'+item.code===value);
      const rankingType=choice?'source':value;
      router.push(featureNavigationHref(scopeId,'statics',{
        ...navigation,rankingType,source:choice?.code
      }));
    }}>
      {types.includes('total')?<option value='total'>{t(STAT_TYPE_KEYS.total)}</option>:null}
      {(types.includes('keywords')||types.includes('source'))?<optgroup label="關鍵詞">
        {types.includes('keywords')?<option value="keywords">{t(STAT_TYPE_KEYS.keywords)}</option>:null}
        {types.includes('source')?<option value="source">來源</option>:null}
        {types.includes('source')?sourceOptions.map(item=><option key={item.key} value={'source:'+item.code}>
          {item.domain?item.domain+' / ':''}{item.label}
        </option>):null}
      </optgroup>:null}
    </select>
  </label>;
}

function ScopeStatisticsResults({scopeId,navigation,types}){
  const UI_COPY=useUiCopy();
  const t=useUiText();
  const requested=String(navigation.rankingType||'');
  const rankingType=types.includes(requested)?requested:
    (['media_type','media_platform','media_style','media','place'].includes(requested)||['keywords','styles'].includes(navigation.statTab)?'keywords':types[0]||'');
  // Multimedia and locations are selected Keyword Classes, not separate data pipelines.
  const keywordDimension=rankingType==='keywords';
  const deviceTimeUnit=useDefaultTimeUnit();
  const {settings:userSettings,active:userActive}=useLocFeatureSettings('statics');
  const defaultTimeUnit=userActive?userSettings.unit:deviceTimeUnit;
  const [chartType,setChartType]=useState('auto');
  const [zoomLevel,setZoomLevel]=useState(0);
  const [foldBlank,setFoldBlank]=useState(true);
  // Leave potentially expensive keyword aggregation OFF until explicitly chosen.
  const [selectedKeywordClassUid,setSelectedKeywordClassUid]=useState('');
  const [sourceGroup,setSourceGroup]=useState(String(navigation.source||''));
  useEffect(()=>{
    setSelectedKeywordClassUid('');
    setSourceGroup(requested==='source'?String(navigation.source||''):'');
  },[scopeId,navigation.statTab,requested,navigation.source]);
  // The current full calendar year is the initial Statistics window, even when
  // Era records exist. A saved Era is selected only by an explicit UI action.
  const [selectedPeriodKey,setSelectedPeriodKey]=useState('year');
  const [periodOptionsRequested,setPeriodOptionsRequested]=useState(false);
  useEffect(()=>{setSelectedPeriodKey('year');setPeriodOptionsRequested(false);},[scopeId]);
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
    // Default Statistics reads Galaxy counts only. Saved TimeAnchor period
    // choices load on the user's interaction, never on landing.
    enabled:periodOptionsRequested&&scopeId!=='local'&&scopeId!=='loc'&&Boolean(targetScopes[0]),
    queryFn:async()=>{
      // Period anchors remain on the independently working direct reader.
      // ISR never becomes a required path when an endpoint is not available.
      const {selectScopeCultureData}=await import('../../loc/culture-query');
      return (await selectScopeCultureData(scopeId)).eras?.eras||[];
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
  },[selectedPeriodKey,selectedPeriod,customQueryRange,queryEndDate,hasRequestedWindow,requestedStart,requestedEnd,defaultTimeUnit]);
  // Both editors store flat names. Show one direct source choice, not a group tree.
  const activeSourceSelection=rankingType==='source'?sourceGroup:'';
  const totalChart=rankingType==='total'&&Boolean(targetScopes.length);
  const sourceChart=rankingType==='source'&&Boolean(targetScopes.length);
  // Statistics landing reads ONLY grouped daily Galaxy totals; it never
  // requests SourceAnchor taxonomy, site grouping or an article list.
  const observedEnd=queryRange.endDate<queryEndDate?queryRange.endDate:queryEndDate;
  const totalDaily=useAsyncResource({
    queryKey:['statistics-total-daily-v1',scopeId,queryRange.startDate,observedEnd],
    enabled:totalChart&&periodNavigationReady&&Boolean(queryRange.startDate&&observedEnd&&queryRange.startDate<=observedEnd),
    queryFn:async()=>{
      const {dbPublicClient}=await import('../../loc/db-client.mjs');
      const {data,error}=await dbPublicClient.schema('silver').analytics({
        p_scope_id:scopeId,p_view:'daily_total',
        p_start:queryRange.startDate,p_end:observedEnd
      });
      if(error)throw error;
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
    queryKey:['scope-overview',scopeId,queryRange.startDate,queryRange.endDate],
    enabled:sourceChart&&periodNavigationReady&&Boolean(queryRange.startDate&&queryRange.endDate),
    queryFn:async()=>{
      const {selectScopeOverview}=await loadGalaxyStatistics();
      const data=await selectScopeOverview(targetScopes[0],queryRange);
      // The self-intersection panel reads the same rows; seed its cache so opening it is free.
      resourceCache.set(['own-scope-source-intersection',scopeId,queryRange.startDate,queryRange.endDate],data.rows);
      return data;
    },
  });
  useEffect(()=>{
    const first=(totalChart?totalDaily.data?.earliest:overview.data?.earliest)||'';
    if(first&&first!==knownEarliest)setKnownEarliest(first);
  },[overview.data,totalDaily.data,totalChart,knownEarliest]);
  const sourceRows={isPending:overview.isPending&&sourceChart,isSuccess:overview.isSuccess,error:overview.error,
    data:overview.data?.rows,dataUpdatedAt:overview.dataUpdatedAt};
  // One public model read of the existing 30 LocAnchor source nodes.
  // The native provider uses the fixed ZenStack LocAnchor model. Do not fall
  // back to ArticleTag, a hardcoded category snapshot or a media taxonomy.
  const sourceTaxonomyQuery=useAsyncResource({
    queryKey:['loc-zmodel-source-taxonomy'],
    enabled:sourceChart,
    queryFn:async()=>{
      const {readPublicSourceTaxonomy}=await import('../../loc/source-catalog-public.mjs');
      return readPublicSourceTaxonomy();
    },
    revalidateOnFocus:false,revalidateOnReconnect:false
  });
  const sourceCatalog={
    isPending:sourceTaxonomyQuery.isPending&&sourceChart,
    isSuccess:sourceTaxonomyQuery.isSuccess,
    error:sourceTaxonomyQuery.error,
    data:sourceTaxonomyQuery.data,
    dataUpdatedAt:sourceTaxonomyQuery.dataUpdatedAt
  };
  const selectedRawNames=null;
  // Numeric counts use the existing scoped database query. Category bucketing
  // is tiny synchronous presentation work, not an independent remote resource:
  // avoid a second loading cycle after the numeric response arrives.
  const adminSource=useMemo(()=>{
    if(!sourceChart||!sourceCatalog.isSuccess)return null;
    return administrativeSourceTrend(overview.data?.rows||[],sourceCatalog.data||{},{
      startDate:queryRange.startDate,endDate:queryRange.endDate,
      unit:queryRange.bucket,sourceCategory:activeSourceSelection,sourceNames:selectedRawNames
    });
  },[sourceChart,sourceCatalog.isSuccess,sourceCatalog.data,overview.data,
    queryRange.startDate,queryRange.endDate,queryRange.bucket,activeSourceSelection]);
  const adminSourceReady=Boolean(adminSource);
  const resolvedAdminSource=adminSource||{rows:[],series:[],distribution:[],total:0};
  const basicTrend=totalChart?totalTrend:resolvedAdminSource.rows;
  const basicSeries=totalChart?[]:resolvedAdminSource.series;
  const basicDistribution=totalChart?[]:resolvedAdminSource.distribution;
  // One grouped source-name index for the active chart, not one full scan
  // per category. Rebuild it only when the selected source dataset changes.
  const sourceNamesByCategory=useMemo(()=>{
    const names=new Map();
    if(!sourceChart)return names;
    const aliases=sourceCatalog.data?.aliases||[];
    const categories=sourceCatalog.data?.categories||[];
    for(const entry of sourceRows.data||[]){
      if(entry.kind!=='source')continue;
      const category=assignedSource(entry.category,aliases,categories);
      const name=String(entry.category??'').trim();
      if(!names.has(category))names.set(category,new Set());
      names.get(category).add(name);
    }
    return new Map([...names].map(([category,sites])=>[category,[...sites]]));
  },[sourceChart,sourceRows.data,sourceCatalog.data]);
  // The existing source breakdown already drives the chart and its summary.
  // Do not re-scan Galaxy and Galaxy Media in a second trend query.
  const sourceSummary={total:resolvedAdminSource.total,
    sources:resolvedAdminSource.distribution.map((row,index)=>{
      // Category codes and labels share the same order in administrativeSourceTrend.
      const category=String(resolvedAdminSource.series[index]?.key||'').replace(/^category_/,'');
      const sourceNames=(sourceNamesByCategory.get(category)||[])
        .filter(name=>!selectedRawNames||selectedRawNames.includes(name.toLowerCase()));
      return {term:row.name,item_count:row.value,category,sourceNames};
    }),
    startDate:queryRange.startDate,endDate:queryRange.endDate,
    rawRows:selectedRawNames?(sourceRows.data||[]).filter(row=>row.kind!=='source'||selectedRawNames.includes(String(row.category||'').trim().toLowerCase())):sourceRows.data||[],
    catalog:sourceCatalog.data||{}
  };
  const optionsForCurrent=semanticStatisticChartTypes({
    purpose:rankingType==='total'?'total':'source',
    rows:basicTrend,series:basicSeries,distribution:basicDistribution,
    totalKey:rankingType==='total'?'total':''
  });
  const effectiveChartType=preferredStatisticChartType({purpose:rankingType==='total'?'total':'source',available:optionsForCurrent,requested:chartType});
  const chartGroups=chartTypeGroups(optionsForCurrent,rankingType==='total'
    ?['line','composed','bar']:['line','stacked','pie']);
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
      const {selectAvailableKeywordClasses}=await import('../../loc/keyword-analysis');
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
      const {selectKeywordAnalysisSummary}=await import('../../loc/keyword-analysis');
      return selectKeywordAnalysisSummary({
        scopeId,classUid:resolvedKeywordClassUid,...styleRange
      });
    },
    enabled:keywordDimension&&periodNavigationReady&&Boolean(resolvedKeywordClassUid)
      &&Boolean(styleRange.startDate&&styleRange.endDate),
  });

  const sourceBreakdownTotal=sourceSummary.sources.reduce((sum,row)=>sum+(Number(row.item_count)||0),0);
  return <section className="scope-stat-section statistics-dashboard">
    <header className="scope-stat-domain-heading statistics-dashboard__heading">
      <div>
        <span className="statistics-dashboard__eyebrow">LOC / ANALYTICS</span>
        <h2>{t('uiExtra.statisticsView.dashboardTitle')}</h2>
        <p>{t('uiExtra.statisticsView.dashboardScopeHelp')}</p>
      </div>
    </header>
    <div className="scope-stat-controls statistics-dashboard__filters">
      <StatisticTypeSelect scopeId={scopeId} navigation={navigation} types={types}
        selectedSource={activeSourceSelection} sourceTaxonomy={sourceCatalog.data}/>
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
          onFocus={()=>setPeriodOptionsRequested(true)}
          onChange={event=>{setPeriodOptionsRequested(true);setSelectedPeriodKey(event.target.value);}}>
          <option value="year">{DEFAULT_YEAR_WINDOW.label}</option>
          <option value="latest">最新時期</option>
          <option value="">自選時間（原有縮放）</option>
          {periodOptionsRequested&&periodQuery.isPending?<option disabled value="__loading">正在載入時期…</option>:null}
          {periods.map(period=><option key={period.uid||period.period} value={String(period.period||period.era_id||period.uid)}>
            {period.title||period.name||period.period}
          </option>)}
        </select>
      </label>
      {rankingType==='source'?<label>
        <span>作品／個人分類</span>
        <select className="scope-select" aria-label="作品／個人分類" value={activeSourceSelection}
          onChange={event=>setSourceGroup(event.target.value)}>
          <option value="">全部來源</option>
          {sourceKeywordOptions(sourceCatalog.data).map(source=>
            <option key={source.code} value={source.code}>
              {source.domain?source.domain+' / ':''}{source.label}
            </option>)}
          <option value="others">未分類</option>
        </select>
      </label>:null}
      {periodQuery.error?<span className="scope-status scope-error">
        時期範圍無法載入，仍可使用自選時間：{featureDataErrorMessage(periodQuery.error,UI_COPY)}
      </span>:null}
      {sourceChart?<><label><span>{UI_COPY.statistics.chart}</span><select className="scope-select" value={effectiveChartType} onChange={event=>setChartType(event.target.value)}>
        {chartGroups.primary.length?<optgroup label={t('uiExtra.statisticsView.chartPrimary')}>
  {chartGroups.primary.map(([value,label])=><option key={value} value={value}>{t(label)}</option>)}
</optgroup>:null}
{chartGroups.advanced.length?<optgroup label={t('uiExtra.statisticsView.chartAdvanced')}>
  {chartGroups.advanced.map(([value,label])=><option key={value} value={value}>{t(label)}</option>)}
</optgroup>:null}{!optionsForCurrent.length?<option value="line"><UiText id="uiExtra.statisticsView.noVisual"/></option>:null}
      </select></label>
      {!['pie','radar','radial','treemap','scatter'].includes(effectiveChartType)?<label className="scope-setting-toggle">
        <input type="checkbox" checked={foldBlank} onChange={event=>setFoldBlank(event.target.checked)}/> <UiText id="uiExtra.statisticsView.foldBlank"/>
      </label>:null}
      </>:null}
    </div>
    <>
    {/* The total-only landing never loads Source taxonomy, article lists or
         category grouping. Advanced Source charts remain explicit. */}
    {totalChart&&totalDaily.isPending?<p className="scope-status" role="status">
      正在統計作品總數… <ActivityMotion kind="numbers"/>
    </p>:null}
    {totalChart&&totalDaily.error?<p className="scope-status scope-error" role="alert">
      {featureDataErrorMessage(totalDaily.error,UI_COPY)}
    </p>:null}
    {totalChart&&!totalDaily.isPending&&!totalDaily.error&&totalDaily.data?<>
      <StatisticsDashboardKpis label="作品總數" items={[
        {key:'records',label:'作品總數',value:basicTrend
          .reduce((sum,row)=>sum+Number(row.total||0),0).toLocaleString()},
        {key:'active',label:'活躍時段',value:basicTrend
          .filter(row=>Number(row.total)>0).length.toLocaleString()},
        {key:'completed',label:'完整觀察時段',value:basicTrend
          .filter(row=>!row.partial).length.toLocaleString()}
      ]}/>
      <StatisticsInsightsPanel rows={basicTrend} range={queryRange}
        zoomLevel={zoomLevel} onZoomLevelChange={setZoomLevel}
        idPrefix="scope-stat" showMethodologyNote={scopeId!=='lo3rwang'}/>
      <StatisticsDetails summary="標準統計圖（折線、長條、面積與組合圖）">
        {()=> <section className="statistics-dashboard__panel" style={{display:'grid',gap:12}}>
          <label><span>{UI_COPY.statistics.chart}</span>
            <select className="scope-select" value={effectiveChartType}
              onChange={event=>setChartType(event.target.value)}>
              {chartGroups.primary.map(([value,label])=><option key={value} value={value}>{t(label)}</option>)}
              {chartGroups.advanced.map(([value,label])=><option key={value} value={value}>{t(label)}</option>)}
            </select>
          </label>
          <StatisticsChartFrame level={zoomLevel} onChange={setZoomLevel}
            range={queryRange} idPrefix="scope-stat">
            <StatisticsMultiChart key={'total:'+effectiveChartType} type={effectiveChartType} rows={basicTrend}
              series={[]} totalKey="total" height={420} foldBlank={foldBlank}/>
          </StatisticsChartFrame>
        </section>}
      </StatisticsDetails>
    </>:null}
    {(sourceChart&&!sourceRows.error&&!sourceCatalog.error&&(sourceRows.isPending||sourceCatalog.isPending||!adminSourceReady))?<div className="scope-stat-data-pending">
      <p className="scope-status" role="status">統計中請稍後 <ActivityMotion kind="numbers"/></p>
    </div>:null}
    {sourceChart&&(sourceRows.error||sourceCatalog.error)?<p className="scope-status scope-error">{featureDataErrorMessage(sourceRows.error||sourceCatalog.error,UI_COPY)}</p>:null}
    {sourceChart&&!sourceRows.isPending&&!sourceCatalog.isPending&&adminSourceReady&&!sourceRows.error&&!sourceCatalog.error?<>
      <StatisticsDashboardKpis label={t('uiExtra.statisticsView.dashboardTitle')} items={[
        {key:'records',label:t('uiExtra.statisticsView.dashboardRecords'),value:sourceSummary.total.toLocaleString()},
        {key:'categories',label:t('uiExtra.statisticsView.dashboardCategoryCount'),value:sourceSummary.sources.length.toLocaleString()},
        {key:'active',label:t('uiExtra.statisticsView.dashboardActiveBuckets'),
          value:basicTrend.filter(row=>Number(row.total)>0).length.toLocaleString()}
      ]}/>
      <div className="statistics-dashboard__workspace">
        <section className="statistics-dashboard__panel statistics-dashboard__panel--chart" aria-label={t('uiExtra.statisticsView.dashboardTrendTitle')}>
          <header className="statistics-dashboard__panel-heading">
            <h3>{t('uiExtra.statisticsView.dashboardTrendTitle')}</h3>
            <p>{sourceSummary.startDate&&sourceSummary.endDate?sourceSummary.startDate+' ～ '+sourceSummary.endDate:''}</p>
          </header>
          <StatisticsChartFrame level={zoomLevel} onChange={setZoomLevel} range={queryRange} idPrefix="scope-stat">
            <StatisticsMultiChart key={'source:'+effectiveChartType} type={effectiveChartType} rows={basicTrend}
              series={basicSeries} distribution={basicDistribution}
              totalKey={rankingType==='total'?'total':''}
              foldBlank={foldBlank} height={420}/>
          </StatisticsChartFrame>
        </section>
        <aside className="statistics-dashboard__panel statistics-dashboard__panel--insights" aria-label={t('uiExtra.statisticsView.dashboardDistributionTitle')}>
          <header className="statistics-dashboard__panel-heading">
            <h3>{t('uiExtra.statisticsView.dashboardDistributionTitle')}</h3>
          </header>
          {sourceSummary.sources.length?<div className="statistics-dashboard__breakdown">
            {[...sourceSummary.sources].sort((a,b)=>b.item_count-a.item_count).slice(0,8).map(row=>{
              const ratio=sourceBreakdownTotal>0?(Number(row.item_count)||0)/sourceBreakdownTotal*100:0;
              return <div key={row.category||row.term} className="statistics-dashboard__breakdown-item">
                <div className="statistics-dashboard__breakdown-label">
                  <span title={row.term}>{row.term}</span>
                  <strong>{Number(row.item_count||0).toLocaleString()}</strong>
                </div>
                <div className="statistics-dashboard__bar" aria-hidden="true"><span style={{width:ratio+'%'}}/></div>
              </div>;
            })}
          </div>:<p className="scope-status">{t('uiExtra.statisticsView.dashboardEmpty')}</p>}
          {/* Source is a deliberately selected Keyword-related facet. No article list. */}
        </aside>
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
  // whose legacy loc_user.statics.display was 'source'.
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
