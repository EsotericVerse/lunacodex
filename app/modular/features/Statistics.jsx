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
import {scopeTagColumn,scopeTagNames} from '../../loc/scope-config-fields.mjs';
import useLocFeatureSettings from '../../loc/use-loc-feature-settings';
import dynamic from 'next/dynamic';
import {useRouter,useSearchParams} from 'next/navigation';
import {useAsyncResource,useAsyncInfiniteResource,useResourceCache} from '../../loc/use-async-resource';

// Defer Galaxy's data/query engine until the selected statistics mode needs it.
const loadGalaxyStatistics=()=>import('../../loc/galaxy-query');
import {selectRows} from '../../loc/db-query.mjs';


import {selectScopeRegistry,defaultScopeData} from '../../loc/scope-data';
import {featureNavigationHref,galaxyIdentityHref,galaxyRelationLinks,readFeatureNavigation} from '../feature-navigation';
import {featureDataErrorMessage} from '../feature-data-state';
import {useScopeRuntime} from '../use-scope-runtime';
import useDefaultTimeUnit from '../../loc/use-default-time-unit';
import {ArticleSortSelect,FeaturePage,IncrementalList,WorkFullText} from '../ui';
import {workDisplayHeading,workDisplayText} from '../work-display-model';
import {DEFAULT_LIST_BATCH_SIZE} from '../../loc/db-contract.mjs';
import {assignedSource} from '../../loc/member-intersection-model.mjs';
import {publishedSourceCategoryCatalog} from '../published-source-taxonomy.js';
import {administrativeSourceTrend} from '../../loc/statistics-admin-source.mjs';
import {useAccount} from '../../loc/use-account';
import {scopeHref} from '../scope-registry';
import ScopeLink from '../ScopeLink';
import {STAT_VISUAL_TYPES,semanticStatisticChartTypes,chartTypeGroups,preferredStatisticChartType} from '../modules/statistics/statistics-time-zoom.mjs';
const StatisticsMultiChart=dynamic(()=>import('../modules/statistics/StatisticsMultiChart'),{loading:()=>null});
const Rune66Summary=dynamic(()=>import('../modules/statistics/StatisticsMultiChart').then(m=>m.Rune66Summary),{loading:()=>null});
const ScopeSelfIntersection=dynamic(()=>import('../modules/statistics/ScopeSelfIntersection'),{loading:()=>null});
const ScopeGroupStatistics=dynamic(()=>import('../modules/statistics/ScopeGroupStatistics'),{loading:()=>null});
const ScopeGroupOverview=dynamic(()=>import('../../loc/ScopeGroupOverview'),{loading:()=>null});
const Article=dynamic(()=>import('../Article'),{loading:()=>null});
import StatisticsChartFrame from '../modules/statistics/StatisticsChartFrame';
import StatisticsDetails from '../modules/statistics/StatisticsDetails';
import {statisticsZoomWindow} from '../modules/statistics/statistics-time-zoom.mjs';

const CHART_TYPES=STAT_VISUAL_TYPES;
const STAT_TYPES=['total','source','keywords'];
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
function SourceArticleList({scope,startDate,endDate,sourceNames=null,defaultSort='desc'}){
  const [selectedUid,setSelectedUid]=useState('');
  const [articleSort,setArticleSort]=useState(defaultSort);
  useEffect(()=>setArticleSort(defaultSort),[defaultSort]);
  const group=Array.isArray(sourceNames);
  const worksQuery=useAsyncInfiniteResource({
    queryKey:['statistics-source-articles',scope.id,startDate,endDate,sourceNames,articleSort],
    initialPageParam:null,
    queryFn:async({pageParam})=>{
      const {selectScopePeriodWorkIndex,selectScopePeriodWorkDetails}=await import('../../loc/culture-query');
      const index=await selectScopePeriodWorkIndex(scope,{
        startDate,endDate,
        sourceName:group?'statistics-source':'',
        sourceNames:sourceNames||[],articlePermission:'statics',
        limit:DEFAULT_LIST_BATCH_SIZE,cursor:pageParam,sortDirection:articleSort
      });
      const {rows}=await selectScopePeriodWorkDetails(scope,{items:index.rows});
      const next=index.nextCursor;
      return {rows,totalCount:index.totalCount,nextCursor:next,
        hasMore:Number(next.galaxyOffset||0)+Number(next.mediaOffset||0)<Number(index.totalCount||0)};
    },
    getNextPageParam:page=>page.hasMore?page.nextCursor:undefined,
  });
  const bodyQuery=useAsyncResource({
    queryKey:['statistics-source-article-body',scope.id,selectedUid],
    enabled:Boolean(selectedUid),
    queryFn:async()=>{
      const {selectGalaxyIdentity}=await loadGalaxyStatistics();
      const result=await selectGalaxyIdentity(scope,selectedUid);
      if(!result)throw new Error('找不到文章內容');
      return result;
    },
  });
  const works=(worksQuery.data?.pages||[]).flatMap(page=>page.rows||[]);
  return <div className="scope-stat-source-works">
    <div className="loc-public-list-header">
      <p className="scope-status">{group?'此來源的文章列表':'全部文章列表'} · {startDate} ～ {endDate}</p>
      <ArticleSortSelect value={articleSort} onChange={setArticleSort}/>
    </div>
    {worksQuery.isPending?<p className="scope-status" role="status">統計中請稍後</p>:null}
    {worksQuery.error?<p className="scope-status scope-error">
      {featureDataErrorMessage(worksQuery.error)} <button type="button" className="loc-button" onClick={()=>worksQuery.refetch()}>重新讀取</button>
    </p>:null}
    <IncrementalList
      items={works}
      batchSize={DEFAULT_LIST_BATCH_SIZE}
      resetKey={scope.id+'|'+startDate+'|'+endDate+'|'+(sourceNames||[]).join('|')+'|'+articleSort}
      className="scope-culture-source-work-scroll loc-public-article-list"
      loading={worksQuery.isFetchingNextPage}
      externalHasMore={Boolean(worksQuery.hasNextPage)}
      onLoadMore={()=>worksQuery.fetchNextPage()}
      renderItem={(work,index)=><Article
        key={work.key||work.uid||work.entry_id||index}
        uid={work.uid}
        title={workDisplayHeading(work,{media:false,limit:80})}
        articleHref={work.entry_type==='work'?galaxyIdentityHref(work.scope_id||scope.id,work.uid):''}
        detailReading={work.entry_type==='work'&&selectedUid===String(work.uid)&&bodyQuery.data?.uid===work.uid}
        relationLinks={selectedUid===String(work.uid)&&bodyQuery.data?.uid===work.uid
          ?galaxyRelationLinks(scope.id,bodyQuery.data):[]}
        relatedMedia={selectedUid===String(work.uid)?bodyQuery.data?.related_media||[]:[]}
        relatedTime={selectedUid===String(work.uid)?bodyQuery.data?.related_time:null}
        relatedSpace={selectedUid===String(work.uid)?bodyQuery.data?.related_space:null}
        relatedStatistics={selectedUid===String(work.uid)?bodyQuery.data?.related_statistics:null}
        articleScopeId={work.scope_id||scope.id}
        date={work.date||work.createtime||work.start_date||''}
        articleDate={selectedUid===String(work.uid)?bodyQuery.data?.article_day||bodyQuery.data?.date:''}
        tracePlace={selectedUid===String(work.uid)?bodyQuery.data?.trace_place:null}
        traceHref={selectedUid===String(work.uid)&&bodyQuery.data?.trace_place
          ?featureNavigationHref(scope.id,'trace',{place:bodyQuery.data.trace_place.uid}):''}
        locationName={selectedUid===String(work.uid)?bodyQuery.data?.location||'':''}
        links={work.entry_type==='media_metadata'?work.links||[]:
          selectedUid===String(work.uid)?bodyQuery.data?.links||[]:[]}
      >{work.entry_type==='work'&&work.uid?<WorkFullText
        open={selectedUid===String(work.uid)}
        loading={selectedUid===String(work.uid)&&bodyQuery.isPending}
        error={selectedUid===String(work.uid)&&bodyQuery.error?featureDataErrorMessage(bodyQuery.error):''}
        content={selectedUid===String(work.uid)?workDisplayText(bodyQuery.data?.content||''):''}
        onToggle={()=>setSelectedUid(old=>old===String(work.uid)?'':String(work.uid))}
      />:null}</Article>}
    />
    {!worksQuery.isPending&&!worksQuery.error&&!works.length?<p className="scope-status">此區間沒有可顯示的作品。</p>:null}
  </div>;
}
// A Scope's subgroups only subdivide the Admin-defined Others total.
// Load on expansion; never turn small-group aliases into global categories.
async function readPersonalSourceClasses(scopeId){
  const {publishedSourceTaxonomy}=await import('../published-source-taxonomy.js');
  const published=publishedSourceTaxonomy(scopeId);
  if(published)return {groups:published.groups||[],aliases:published.groupAliases||[]};
  const {sourceTaxonomyFromArrays}=await import('../../loc/source-classification.mjs');
  const {rows}=await selectRows('silver.'+scopeId,{
    columns:scopeTagColumn(scopeId),filters:[{column:'id',operator:'eq',value:scopeId}],limit:1
  });
  const mapped=sourceTaxonomyFromArrays([],scopeTagNames(scopeId,rows[0]));
  return {groups:mapped.groups,aliases:mapped.groupAliases};
}
function SummaryList({rankingType,summary,scope,range,filteredSource=false,defaultSort='desc'}){
  const UI_COPY=useUiCopy();
  const rows=rankingType==='total'
    ?[{term:UI_COPY.statistics.totalSource,item_count:summary.total,
      sourceNames:filteredSource?summary.sources.flatMap(row=>row.sourceNames||[]):null}]
    :summary.sources;
  return <div className="scope-ranking">
    {rows.map(row=><div key={row.category||row.term} style={{display:'block'}}>
      <StatisticsDetails className="scope-stat-details" summary={<><strong>{row.term}</strong><span>{Number(row.item_count||0).toLocaleString()}</span></>}>
        {()=> <>
          {filteredSource&&rankingType==='total'&&!row.sourceNames?.length
            ?<p className="scope-status">所選來源在此區間沒有作品。</p>
            :<SourceArticleList key={scope.id+'|'+range.startDate+'|'+range.endDate}
              scope={scope} startDate={range.startDate} endDate={range.endDate} defaultSort={defaultSort}
              sourceNames={row.sourceNames}/>} 
        </>}
      </StatisticsDetails>
    </div>)}
  </div>;
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

function StatisticTypeSelect({scopeId,navigation,types}){
  const UI_COPY=useUiCopy();
  const t=useUiText();
  const router=useRouter();
  const requested=String(navigation.rankingType||'');
  const active=types.includes(requested)?requested:(types[0]||'');
  if(!types.length)return null;
  return <label>
    <span>{UI_COPY.statistics.item}</span>
    <select id="statistics-ranking-type" className="scope-select" value={active} onChange={event=>{
      const value=event.target.value;
      if(!value||value===active)return;
      router.push(featureNavigationHref(scopeId,'statics',{...navigation,rankingType:value}));
    }}>
      {types.map(value=><option key={value} value={value}>{t(STAT_TYPE_KEYS[value]||value)}</option>)}
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
  const [sourceGroup,setSourceGroup]=useState('');
    useEffect(()=>{
    setSelectedKeywordClassUid('');
    setSourceGroup('');
  },[scopeId,navigation.statTab,requested]);
  // Period is the primary Statistics navigation. Default to the latest
  // saved Period, not an unnecessary preliminary one-year statistics fetch.
  const [selectedPeriodKey,setSelectedPeriodKey]=useState('latest');
  useEffect(()=>{setSelectedPeriodKey('latest');},[scopeId]);
  const queryEndDate=useMemo(()=>taipeiDateKey(),[]);
  // The active route already resolves the requested Scope; no registry-wide SELECT.
  const targetScopes=useMemo(()=>[defaultScopeData(scopeId)].filter(Boolean),[scopeId]);
  const resourceCache=useResourceCache();
  // The earliest date only widens the zoom-out limit. It arrives with the chart data
  // itself, so the first window (last year) never waits for it.
  const [knownEarliest,setKnownEarliest]=useState('');
  const customQueryRange=useMemo(()=>statisticsZoomWindow(zoomLevel,queryEndDate,knownEarliest),
    [zoomLevel,queryEndDate,knownEarliest]);
  const periodQuery=useAsyncResource({
    queryKey:['culture-time-periods',scopeId],
    enabled:scopeId!=='local'&&scopeId!=='loc'&&Boolean(targetScopes[0]),
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
  const periodNavigationReady=hasRequestedWindow||scopeId==='local'||scopeId==='loc'||periodQuery.data!==undefined||Boolean(periodQuery.error);
  const queryRange=useMemo(()=>{
    if(hasRequestedWindow){
      const days=Math.round((Date.parse(requestedEnd+'T00:00:00Z')-Date.parse(requestedStart+'T00:00:00Z'))/86_400_000);
      return {...customQueryRange,startDate:requestedStart,endDate:requestedEnd,
        bucket:defaultTimeUnit==='auto'?(days>180?'month':days>31?'week':'day'):defaultTimeUnit,
        fullHistory:false,canZoomOut:false,canZoomIn:false};
    }
    if(!selectedPeriod)return defaultTimeUnit==='auto'?customQueryRange:{...customQueryRange,bucket:defaultTimeUnit};
    const startDate=String(selectedPeriod.start_date).slice(0,10);
    const endDate=String(selectedPeriod.end_date||queryEndDate).slice(0,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(startDate)||!/^\d{4}-\d{2}-\d{2}$/.test(endDate)||startDate>endDate)return customQueryRange;
    const days=Math.round((Date.parse(endDate+'T00:00:00Z')-Date.parse(startDate+'T00:00:00Z'))/86_400_000);
    return {...customQueryRange,startDate,endDate,
      bucket:defaultTimeUnit==='auto'?(days>180?'month':days>31?'week':'day'):defaultTimeUnit,
      fullHistory:false,canZoomOut:false,canZoomIn:false};
  },[selectedPeriod,customQueryRange,queryEndDate,hasRequestedWindow,requestedStart,requestedEnd,defaultTimeUnit]);
  // Both editors store flat names. Show one direct source choice, not a group tree.
  const activeSourceSelection=rankingType==='source'?sourceGroup:'';
  const sourceChart=['total','source'].includes(rankingType)&&Boolean(targetScopes.length);
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
    const first=overview.data?.earliest||'';
    if(first&&first!==knownEarliest)setKnownEarliest(first);
  },[overview.data,knownEarliest]);
  const sourceRows={isPending:overview.isPending&&sourceChart,isSuccess:overview.isSuccess,error:overview.error,
    data:overview.data?.rows,dataUpdatedAt:overview.dataUpdatedAt};
  // Public Scopes have a published JS category snapshot. Reuse it in Culture
  // and Statistics; never schedule a separate classification request to draw
  // an already ISR-cached chart. Only an unknown Scope falls back to DefaultArticleClass.
  const publishedCatalog=useMemo(()=>publishedSourceCategoryCatalog(scopeId),[scopeId]);
  const othersConfig=useAsyncResource({
    queryKey:['scope-others-source-summary',scopeId],
    enabled:sourceChart&&Boolean(scopeId)&&!publishedCatalog,
    queryFn:async()=>readPersonalSourceClasses(scopeId),
    revalidateOnFocus:false,revalidateOnReconnect:false
  });
  const sourceCatalog=useMemo(()=>{
    const ready=Boolean(publishedCatalog||othersConfig.isSuccess);
    const dynamic=othersConfig.data;
    return {
      isPending:(overview.isPending||!ready)&&sourceChart,
      isSuccess:overview.isSuccess&&ready,
      error:publishedCatalog?null:othersConfig.error,
      data:overview.data?(publishedCatalog||{
        categories:[...(overview.data?.categories||[]),
          ...(dynamic?.groups||[]).map(group=>({
            category_code:group.group_code,display_name:group.display_name,enabled:true
          }))],
        aliases:[...(overview.data?.aliases||[]),
          ...(dynamic?.aliases||[]).map(item=>({
            source_key:item.source_key,category_code:item.group_code
          }))]
      }):undefined,
      dataUpdatedAt:Math.max(overview.dataUpdatedAt||0,publishedCatalog?0:othersConfig.dataUpdatedAt||0)
    };
  },[publishedCatalog,overview.isPending,overview.isSuccess,overview.data,overview.dataUpdatedAt,
    othersConfig.isSuccess,othersConfig.data,othersConfig.error,othersConfig.dataUpdatedAt,sourceChart]);
  const selectedRawNames=null;
  // Numeric counts come from ISR. Category bucketing is tiny synchronous
  // presentation work, not an independent remote resource: avoid a second SWR
  // suspense/loading cycle after the cached numeric response arrives.
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
  const basicTrend=resolvedAdminSource.rows;
  const basicSeries=resolvedAdminSource.series;
  const basicDistribution=resolvedAdminSource.distribution;
  // The existing source breakdown already drives the chart and its summary.
  // Do not re-scan Galaxy and Galaxy Media in a second trend query.
  const sourceSummary={total:resolvedAdminSource.total,
    sources:resolvedAdminSource.distribution.map((row,index)=>{
      // Category codes and labels share the same order in administrativeSourceTrend.
      const category=String(resolvedAdminSource.series[index]?.key||'').replace(/^category_/,'');
      const sourceNames=[...new Set((sourceRows.data||[])
        .filter(entry=>entry.kind==='source'&&assignedSource(entry.category,
          sourceCatalog.data?.aliases||[],sourceCatalog.data?.categories||[])===category)
        .map(entry=>String(entry.category??'').trim())
        .filter(name=>!selectedRawNames||selectedRawNames.includes(name.toLowerCase())))];
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
  const keywordAccount=useAccount({enabled:keywordDimension});
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

  return <section className="scope-stat-section">
    <header className="scope-stat-domain-heading"><div><h2>{UI_COPY.statistics.result}</h2></div></header>
    <div className="scope-stat-controls">
      <StatisticTypeSelect scopeId={scopeId} navigation={navigation} types={types}/>
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
          onChange={event=>setSelectedPeriodKey(event.target.value)}>
          <option value="latest">{periods.length?'最新時期':'未設定時期（預設時間）'}</option>
          <option value="">自選時間（原有縮放）</option>
          {periodQuery.isPending?<option disabled value="__loading">正在載入時期…</option>:null}
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
          {(sourceCatalog.data?.categories||[]).filter(row=>row.enabled!==false)
            .map(source=><option key={source.category_code} value={source.category_code}>{source.display_name}</option>)}
          <option value="unclassified">未分類</option>
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
    {/* Place is a Keyword Category. Do not issue a second place_id/anchor aggregation. */}
    {(sourceChart&&!sourceRows.error&&!sourceCatalog.error&&(sourceRows.isPending||sourceCatalog.isPending||!adminSourceReady))?<div className="scope-stat-data-pending">
      <p className="scope-status" role="status">統計中請稍後</p>
      <div className="scope-feature-loading__body" aria-hidden="true"><span/><span/><span/><span/></div>
    </div>:null}
    {sourceChart&&(sourceRows.error||sourceCatalog.error)?<p className="scope-status scope-error">{featureDataErrorMessage(sourceRows.error||sourceCatalog.error,UI_COPY)}</p>:null}
    {sourceChart&&!sourceRows.isPending&&!sourceCatalog.isPending&&adminSourceReady&&!sourceRows.error&&!sourceCatalog.error?<>
      <p className="scope-status">{sourceSummary.startDate&&sourceSummary.endDate?sourceSummary.startDate+' ～ '+sourceSummary.endDate:''}</p>
      <StatisticsChartFrame level={zoomLevel} onChange={setZoomLevel} range={queryRange} idPrefix="scope-stat">
        <StatisticsMultiChart
          type={effectiveChartType}
          rows={basicTrend}
          series={basicSeries}
          distribution={basicDistribution}
          totalKey={rankingType==='total'?'total':''}
          foldBlank={foldBlank}
          height={420}
        />
      </StatisticsChartFrame>
      <StatisticsDetails>{()=> <SummaryList rankingType={rankingType} summary={sourceSummary}
        scope={targetScopes[0]} range={queryRange} filteredSource={Boolean(activeSourceSelection)}
        defaultSort={userActive?userSettings.sort:'desc'}/>}</StatisticsDetails>
    </>:null}
    {keywordDimension?<>
      {keywordClassQuery.isPending?<p className="scope-status">正在讀取關鍵詞組設定…</p>:null}
      {!keywordClassQuery.isPending&&!keywordClassQuery.error&&!scopedKeywordClasses.length?<p className="scope-status">目前沒有可查看的關鍵詞科目；請先建立或公開科目。</p>:null}
      {runeQuery.isPending?<p className="scope-status"><UiText id="uiExtra.statisticsUI.loadingKeywordAttrs"/></p>:null}
      {runeQuery.error?<p className="scope-status scope-error">{featureDataErrorMessage(runeQuery.error)}</p>:null}
      {!runeQuery.isPending&&!runeQuery.error&&runeQuery.data?<Rune66Summary key={resolvedKeywordClassUid} analysis={runeQuery.data} range={queryRange} scopeId={scopeId}/>:null}
      {!runeQuery.isPending&&!runeQuery.error&&runeQuery.data&&!runeQuery.data.staticstime?<p className="scope-status">此關鍵詞組尚無已完成的分析結果；請先在關鍵詞管理執行分析，不以其他詞組數據代替。</p>:null}
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
  const {settings:userSettings,active:userActive}=useLocFeatureSettings('statics');
  const activeNavigation=useMemo(()=>
    userActive&&!navigation.rankingType
      ?{...navigation,rankingType:userSettings.display}:navigation,
    [navigation,userActive,userSettings.display]);
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
