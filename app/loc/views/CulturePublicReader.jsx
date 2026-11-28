'use client';
import {useEffect,useMemo,useRef,useState,useTransition} from 'react';
import dynamic from 'next/dynamic';
import {useScopeRuntime} from '../../modular/use-scope-runtime';
import {FeaturePage} from '../../modular/ui';
import {queryCultureContent} from '../actions/culture/queries.mjs';
import {defaultScopeData} from '../scope/scope-data';
import {selectCultureArticleListPage,CULTURE_ARTICLE_PAGE_SIZE} from '../culture/query';
import {selectGalaxyIdentity} from '../galaxy/galaxy-query';
import ScopeLink from '../../modular/ScopeLink';
import {galaxyIdentityHref,galaxyRelationLinks,featureNavigationHref} from '../../modular/routing/feature-navigation';
import {scopeHref} from '../../modular/routing/scope-registry';
import {publicCultureSourceModel} from '../culture/public-source-river.mjs';
import {readPublicSourceTaxonomy} from '../source/catalog-public.mjs';
import {DEFAULT_YEAR_WINDOW} from '../preferences/default-year-window.mjs';
import {readLucusFeature,readAllLucusFeature} from '../model/feature-query-client.mjs';
import {buildPublicTimeLucusRiver} from '../culture/public-time-river.mjs';
import {buildLocEraIndex,locEraWindows} from '../culture/loc-group-river.mjs';
import {useRiverDensityAnalysis} from '../../modular/modules/culture-timeline/use-river-density-analysis';
import {prepareTransientResourceAction} from '../../../packages/zenstack/client-queries';
import ActivityMotion from '../../modular/ActivityMotion';
import {TERRITORY_STOPS,territoryLegendColor} from '../../modular/visual-palette.mjs';
import LocGroupCultureReader from './LocGroupCultureReader';

const CultureTimeline=dynamic(()=>import('../../modular/modules/culture-timeline/CultureTimeline'),{
  loading:()=> <div className='scope-culture-density-loading' role='status' aria-busy='true'>
    <span className='scope-culture-density-loading__bar' aria-hidden='true'/>
    <span>正在準備時間長河…</span>
  </div>
});
const CulturePeriodStatistics=dynamic(()=>import('../../modular/modules/statistics/StatisticsMultiChart'),{
  ssr:false,loading:()=>null
});
const Article=dynamic(()=>import('../../modular/Article'),{loading:()=>null});
const NO_ITEMS=Object.freeze([]);
const NO_FOCUS=Object.freeze({});
const datePart=value=>String(value||'').slice(0,10);
const validDateKey=value=>/^\d{4}-\d{2}-\d{2}$/.test(String(value||''))
  &&Number.isFinite(Date.parse(String(value)+'T00:00:00Z'));
function list(value){
  return Array.isArray(value)?value:[];
}
function attributes(row){
  if(typeof row?.attr==='string'){
    try{return JSON.parse(row.attr)||{};}catch{return {};}
  }
  return row?.attr||{};
}
const linkedUids=(row,key)=>[...new Set(list(attributes(row)[key])
  .map(value=>String(value||'').trim()).filter(value=>/^[A-Za-z0-9]{8}$/.test(value)))];
function mergeTimeRows(...collections){
  const rows=new Map();
  for(const row of collections.flat()){
    const uid=String(row?.uid||'').trim();
    if(uid)rows.set(uid,row);
  }
  return [...rows.values()];
}
function rangeBounds(windows=[]){
  const starts=windows.map(row=>row.startDate).filter(Boolean).sort();
  const ends=windows.map(row=>row.endDate).filter(Boolean).sort();
  return {start:starts[0]||'',end:ends.at(-1)||''};
}
function dateInsideWindows(value,windows=[]){
  const day=datePart(value);
  return validDateKey(day)&&windows.some(range=>
    day>=range.startDate&&day<=range.endDate);
}
async function readTimeLucusByUid(scopeId,type,uids,isCurrent=()=>true){
  const unique=[...new Set(uids)].filter(uid=>/^[A-Za-z0-9]{8}$/.test(String(uid)));
  const rows=[];
  for(let offset=0;offset<unique.length;offset+=100){
    if(!isCurrent())return [];
    const chunk=unique.slice(offset,offset+100);
    const result=await readLucusFeature({scope:scopeId,family:'time',types:[type],uids:chunk,limit:chunk.length});
    if(!isCurrent())return [];
    rows.push(...(Array.isArray(result?.rows)?result.rows:[]));
  }
  return rows;
}
// Source tree groups use the same LocLucus UID hierarchy as the management
// editor and Statistics. Multimedia is a Universe, not a media-type pipeline.
// Keyword density has its own two-level Class/Group display. Source mode
// alone uses the full four-level published SiteLucus hierarchy.
function keywordSourceModel(rows,expanded,start,end){
  const bySite=new Map(),totals=new Map();
  let max=1;
  for(const row of list(rows)){
    const site=String(row.site||''),day=String(row.day||'');
    const count=Number(row.item_count)||0;
    if(!site||!day||day<start||day>end||count<=0)continue;
    if(!bySite.has(site))bySite.set(site,[]);
    bySite.get(site).push({day,count});
    totals.set(site,(totals.get(site)||0)+count);
    max=Math.max(max,count);
  }
  const opened=expanded.includes('keyword');
  const groups=[{id:'root:keyword',label:'關鍵詞 ('+[...totals.values()].reduce((a,b)=>a+b,0)+')',
    order:0,collapsible:true,expanded:opened}],items=[],sites=[];
  const totalDays=new Map();
  for(const [site,days] of bySite){
    for(const {day,count} of days)totalDays.set(day,(totalDays.get(day)||0)+count);
  }
  for(const [day,count] of totalDays){
    items.push({id:'root:keyword:'+day,entry_type:'source_total',
      group_key:'root:keyword',group_label:'關鍵詞',start_date:day,
      item_count:count,density_ratio:count/max,display_label:'',title:day+' · '+count});
  }
  if(opened)for(const [site,days] of bySite){
    const id='site:keyword:'+site;
    groups.push({id,label:'　'+site+' ('+totals.get(site)+')',selectable:true,order:groups.length});
    for(const {day,count} of days)items.push({
      id:id+':'+day,entry_type:'source',group_key:id,group_label:site,
      start_date:day,item_count:count,density_ratio:count/max,
      display_label:'',title:day+' · '+site+' · '+count
    });
  }
  return {groups,items,sites};
}
async function queryCultureData(scope,kind,start,end,signal=null,ranges=null){
  signal?.throwIfAborted?.();
  const params=new URLSearchParams({kind,scope});
  if(start)params.set('start',start);
  if(end)params.set('end',end);
  if(Array.isArray(ranges)&&ranges.length)params.set('ranges',JSON.stringify(ranges));
  const {data}=await queryCultureContent(params.toString());
  signal?.throwIfAborted?.();
  return Array.isArray(data)?data:[];
}
function ScopeCulturePublicReader(){
  const {scopeId}=useScopeRuntime();
  const [sourceExpansionPending,startSourceExpansion]=useTransition();
  const scope=useMemo(()=>defaultScopeData(scopeId),[scopeId]);
  const start=DEFAULT_YEAR_WINDOW.startDate;
  const end=DEFAULT_YEAR_WINDOW.endDate;
  const [eraChoices,setEraChoices]=useState(NO_ITEMS);
  const [timeIndexRows,setTimeIndexRows]=useState(NO_ITEMS);
  const [customTimeRows,setCustomTimeRows]=useState(NO_ITEMS);
  const [expandedEras,setExpandedEras]=useState([]);
  const [periodChoices,setPeriodChoices]=useState(NO_ITEMS);
  const [activeTimeRows,setActiveTimeRows]=useState(NO_ITEMS);
  const [selectedPeriodUid,setSelectedPeriodUid]=useState('');
  const [selectedPeriodRange,setSelectedPeriodRange]=useState(null);
  const [periodsLoading,setPeriodsLoading]=useState(false);
  const [periodDatesLoading,setPeriodDatesLoading]=useState(false);
  const [hierarchyError,setHierarchyError]=useState('');
  const [densityPeriod,setDensityPeriod]=useState('year');
  const [densityMode,setDensityMode]=useState('source');
  const [keywordClass,setKeywordClass]=useState('');
  const [keywordClasses,setKeywordClasses]=useState(NO_ITEMS);
  const [keywordGroups,setKeywordGroups]=useState(NO_ITEMS);
  const [keywordDaily,setKeywordDaily]=useState(NO_ITEMS);
  const [keywordLoading,setKeywordLoading]=useState(false);
  const [keywordReadyKey,setKeywordReadyKey]=useState('');
  const [customStart,setCustomStart]=useState('');
  const [customEnd,setCustomEnd]=useState('');
  const [keywordError,setKeywordError]=useState('');
  const [classesLoading,setClassesLoading]=useState(false);
  const [daily,setDaily]=useState(NO_ITEMS);
  const [densityLoading,setDensityLoading]=useState(false);
  const [densityReadyKey,setDensityReadyKey]=useState('');
  const [catalog,setCatalog]=useState(null);
  const [catalogLoading,setCatalogLoading]=useState(true);
  const [catalogError,setCatalogError]=useState('');
  const [loading,setLoading]=useState(true);
  const [expandedSources,setExpandedSources]=useState([]);
  const [lucusSuggestionsOpen,setLucusSuggestionsOpen]=useState(false);
  const [focusedSuggestionDate,setFocusedSuggestionDate]=useState('');
  const [selectedSite,setSelectedSite]=useState('');
  const [selectedSites,setSelectedSites]=useState(NO_ITEMS);
  const [selectedCategoryKey,setSelectedCategoryKey]=useState('');
  const [articleRows,setArticleRows]=useState([]);
  const [articleOffset,setArticleOffset]=useState(0);
  const [articlePageStart,setArticlePageStart]=useState(0);
  const [articleMore,setArticleMore]=useState(false);
  const [articlesOpen,setArticlesOpen]=useState(false);
  const [articlesLoading,setArticlesLoading]=useState(false);
  const [articleError,setArticleError]=useState('');
  const [fullUid,setFullUid]=useState('');
  const [fullText,setFullText]=useState('');
  const [fullDetail,setFullDetail]=useState(null);
  const [fullError,setFullError]=useState('');
  const selectedEra=eraChoices.find(item=>String(item.uid)===densityPeriod)||null;
  const selectedPeriod=periodChoices.find(item=>String(item.uid)===selectedPeriodUid)||null;
  const rangeStart=densityPeriod==='custom'?customStart:
    densityPeriod==='year'?start:selectedPeriodRange?.start||'';
  const rangeEnd=densityPeriod==='custom'?customEnd:
    densityPeriod==='year'?end:selectedPeriodRange?.end||'';
  const validRange=/^\d{4}-\d{2}-\d{2}$/.test(rangeStart)&&
    /^\d{4}-\d{2}-\d{2}$/.test(rangeEnd)&&rangeStart<=rangeEnd;
  const activeEraIndex=useMemo(()=>{
    const selected=eraChoices.findIndex(row=>String(row.uid)===densityPeriod);
    if(selected>=0)return selected;
    const targetStart=densityPeriod==='custom'?customStart:start;
    const targetEnd=densityPeriod==='custom'?customEnd:end;
    if(!validDateKey(targetStart)||!validDateKey(targetEnd)||targetStart>targetEnd)return -1;
    return eraChoices.findIndex(era=>locEraWindows(era).some(window=>
      window.startDate<=targetEnd&&window.endDate>=targetStart));
  },[eraChoices,densityPeriod,customStart,customEnd,start,end]);
  const activeRangeWindows=useMemo(()=>{
    const saved=list(selectedPeriodRange?.windows).filter(range=>
      validDateKey(range?.startDate)&&validDateKey(range?.endDate)&&
      range.startDate<=range.endDate);
    return saved.length?saved:validRange?[{startDate:rangeStart,endDate:rangeEnd}]:[];
  },[selectedPeriodRange,rangeStart,rangeEnd,validRange]);
  const rangeSignature=JSON.stringify(activeRangeWindows);
  const densityKey=[scopeId,rangeStart,rangeEnd,rangeSignature].join('|');
  const sourceDensityPending=densityMode==='source'&&validRange&&
    (densityLoading||densityReadyKey!==densityKey);
  const keywordDensityKey=[scopeId,keywordClass,rangeStart,rangeEnd,rangeSignature].join('|');
  const keywordDensityPending=densityMode==='keyword'&&Boolean(keywordClass)&&
    (keywordLoading||keywordReadyKey!==keywordDensityKey);
  const riverPending=sourceDensityPending||keywordDensityPending;
  const timeRowsForRiver=activeTimeRows.length?activeTimeRows:
    densityPeriod==='custom'?customTimeRows:timeIndexRows;
  const timeRiverStart=activeTimeRows.length||densityPeriod==='custom'?rangeStart:start;
  const timeRiverEnd=activeTimeRows.length||densityPeriod==='custom'?rangeEnd:end;
  const sequence=useRef(0);
  const fullSequence=useRef(0);
  const hierarchySequence=useRef(0);
  const densityAbortRef=useRef(null);
  const articleAbortRef=useRef(null);
  useEffect(()=>()=>{
    articleAbortRef.current?.abort();densityAbortRef.current?.abort();
    sequence.current++;fullSequence.current++;hierarchySequence.current++;
  },[]);
  useEffect(()=>{
    let cancelled=false;
    setLoading(true);setCatalogError('');setCatalog(null);
    setCatalogLoading(true);setEraChoices(NO_ITEMS);setTimeIndexRows(NO_ITEMS);
    setPeriodChoices(NO_ITEMS);
    setActiveTimeRows(NO_ITEMS);setSelectedPeriodUid('');setSelectedPeriodRange(null);
    setExpandedEras([]);setCustomTimeRows(NO_ITEMS);setHierarchyError('');
    // Initial TimeLucus projection is bounded by the default year. Era/Period
    // metadata stays available for navigation; DateLucus rows do not scan history.
    // One bounded TimeLucus read: keep all Era/Period metadata, but only
    // DateLucus points inside the initial year. The source-density query below
    // is the second large read; neither river needs an all-history date scan.
    readAllLucusFeature({scope:scopeId,family:'time',types:['era','period','date'],
      dateStart:start,dateEnd:end})
      .then(async rows=>{
        if(cancelled)return;
        const scopedRows=rows.map(row=>({...row,scope_id:scopeId}));
        // Era ordering needs only each Period's real endpoint DateLucus UIDs;
        // the full historical DateLucus corpus is never scanned at first paint.
        const endpointUids=[...new Set(scopedRows
          .filter(row=>row.type==='period')
          .flatMap(row=>linkedUids(row,'uid').slice(0,2)))];
        const endpointRows=await readTimeLucusByUid(scopeId,'date',endpointUids,
          ()=>!cancelled);
        if(cancelled)return;
        const indexedRows=mergeTimeRows(scopedRows,
          endpointRows.map(row=>({...row,scope_id:scopeId})));
        setTimeIndexRows(indexedRows);
        setEraChoices(buildLocEraIndex(indexedRows));
        setLoading(false);
      })
      .catch(reason=>{if(!cancelled){
        setHierarchyError(String(reason?.message||reason));setLoading(false);
      }});
    readPublicSourceTaxonomy()
      .then(types=>{if(!cancelled){setCatalog(types);setCatalogError('');}})
      .catch(reason=>{if(!cancelled){
        // A failed request is NOT an empty taxonomy.
        setCatalog(null);
        setCatalogError(String(reason?.message||reason));
      }})
      .finally(()=>{if(!cancelled)setCatalogLoading(false);});
    return()=>{cancelled=true;hierarchySequence.current++;};
  },[scopeId,start,end]);
  useEffect(()=>{
    if(densityPeriod!=='custom'||!validRange){
      if(densityPeriod!=='custom')setCustomTimeRows(NO_ITEMS);
      return undefined;
    }
    let active=true;
    setCustomTimeRows(NO_ITEMS);
    readAllLucusFeature({scope:scopeId,family:'time',types:['era','period','date'],
      dateStart:rangeStart,dateEnd:rangeEnd})
      .then(rows=>{if(active)setCustomTimeRows(rows);})
      .catch(reason=>{if(active)setHierarchyError(String(reason?.message||reason));});
    return()=>{active=false;};
  },[scopeId,densityPeriod,rangeStart,rangeEnd,validRange]);
  useEffect(()=>{
    let active=true;
    const controller=new AbortController();
    densityAbortRef.current=controller;
    // A changed Era invalidates the previous SQL read immediately; do not
    // wait for an old fetch to settle while retaining the previous chart.
    setDaily(NO_ITEMS);setDensityReadyKey('');
    setDensityLoading(validRange&&densityMode==='source');
    setKeywordError('');
    if(!validRange||densityMode!=='source')
      return()=>{active=false;controller.abort();
        if(densityAbortRef.current===controller)densityAbortRef.current=null;};
    queryCultureData(scopeId,'culture_density',rangeStart,rangeEnd,
      controller.signal,activeRangeWindows)
      .then(rows=>{
        if(!active||controller.signal.aborted)return;
        setDaily(rows.filter(row=>dateInsideWindows(row.day,activeRangeWindows)));
        setDensityReadyKey(densityKey);
      })
      .catch(error=>{
        if(!active||controller.signal.aborted||error?.name==='AbortError')return;
        setKeywordError(String(error?.message||error));setDensityReadyKey(densityKey);
      })
      .finally(()=>{if(active)setDensityLoading(false);});
    return()=>{active=false;controller.abort();
      if(densityAbortRef.current===controller)densityAbortRef.current=null;};
  },[scopeId,rangeStart,rangeEnd,rangeSignature,validRange,densityMode]);
  useEffect(()=>{
    // Release old class snapshots when switching tabs, subjects or dates.
    if(densityMode!=='keyword'||!keywordClass){
      setKeywordGroups(NO_ITEMS);setKeywordDaily(NO_ITEMS);
      setKeywordReadyKey('');setKeywordLoading(false);
      return undefined;
    }
    let active=true;
    const controller=new AbortController();
    setKeywordGroups(NO_ITEMS);setKeywordDaily(NO_ITEMS);
    setKeywordReadyKey('');setKeywordLoading(true);
    import('../keywords/service-client.mjs')
      .then(({keywordService})=>keywordService('stats',{
        scopeId,classUid:keywordClass,startDate:rangeStart,endDate:rangeEnd
      },{signal:controller.signal}))
      .then(data=>{
        if(!active)return;
        const groups=Array.isArray(data?.groups)?data.groups:[];
        setKeywordGroups(groups.map(group=>({
          id:String(group.uid),name:String(group.name||group.uid),
          weight:Math.max(0,Number(group.hit_count)||0)
        })));
        const names=new Map(groups.map(row=>[String(row.uid),String(row.name||row.uid)]));
        setKeywordDaily((data?.daily||[])
          .filter(row=>row.kind==='class_day'&&dateInsideWindows(row.day,activeRangeWindows))
          .map(row=>({day:row.day,site:names.get(String(row.group_uid))||'',
            item_count:Number(row.document_count)||0}))
          .filter(row=>row.site));
        setKeywordReadyKey(keywordDensityKey);
      }).catch(error=>{
        if(active&&!controller.signal.aborted){
          setKeywordError(String(error?.message||error));
          setKeywordReadyKey(keywordDensityKey);
        }
      })
      .finally(()=>{if(active)setKeywordLoading(false);});
    return()=>{active=false;controller.abort();};
  },[scopeId,densityMode,keywordClass,rangeStart,rangeEnd,rangeSignature]);
  useEffect(()=>{
    if(densityMode!=='keyword'){
      setKeywordClasses(NO_ITEMS);setClassesLoading(false);
      return undefined;
    }
    let active=true;
    setClassesLoading(true);
    import('../keywords/service-client.mjs')
      .then(({keywordService})=>keywordService('classes',{scopeId}))
      .then(result=>{if(active)setKeywordClasses(result?.classes||[]);})
      .catch(error=>{if(active)setKeywordError(String(error?.message||error));})
      .finally(()=>{if(active)setClassesLoading(false);});
    return()=>{active=false;};
  },[scopeId,densityMode]);
  // The first river is a bounded TimeLucus snapshot. Selecting an older Era
  // still loads its Period and linked DateLucus on demand for that interval.
  const lucusRiver=useMemo(()=>buildPublicTimeLucusRiver(timeRowsForRiver,{
    startDate:timeRiverStart,endDate:timeRiverEnd,
    expandedEras
  }),[timeRowsForRiver,timeRiverStart,timeRiverEnd,expandedEras]);
  const existingLucusDates=useMemo(()=>timeRowsForRiver
    .filter(row=>row.type==='date')
    .map(row=>datePart(attributes(row).date)).filter(Boolean),[timeRowsForRiver]);
  const candidateDensityRows=densityMode==='keyword'?keywordDaily:daily;
  const periodStatisticsRows=useMemo(()=>{
    const totals=new Map();
    for(const row of candidateDensityRows){
      const day=datePart(row.day);
      if(!validDateKey(day))continue;
      totals.set(day,(totals.get(day)||0)+(Number(row.item_count)||0));
    }
    return [...totals].sort(([a],[b])=>a.localeCompare(b)).map(([day,total])=>({
      period:day.slice(5).replace('-','/'),start_date:day,end_date:day,total
    }));
  },[candidateDensityRows]);
  // Run Karaul/PELT only when the visitor opens the permanent suggestion
  // lane. Reuse the daily rows already fetched for the second river.
  const suggestionAnalysis=useRiverDensityAnalysis(candidateDensityRows,
    existingLucusDates,lucusSuggestionsOpen&&validRange&&candidateDensityRows.length>0);
  const selectedSuggestion=suggestionAnalysis.suggestions.find(
    item=>item.date===focusedSuggestionDate)||null;
  const densityRiver=useMemo(()=>{
    const base=densityMode==='keyword'
      ?keywordSourceModel(keywordDaily,expandedSources,rangeStart,rangeEnd)
      :catalog?publicCultureSourceModel(daily,catalog,expandedSources,rangeStart,rangeEnd)
        :{items:[],groups:[],sites:[]};
    const candidateLane={
      id:'root:lucus-suggestions',label:lucusSuggestionsOpen
        ?'建議定錨點（'+suggestionAnalysis.suggestions.length+'）':'建議定錨點',
      order:9999,className:'scope-candidate-lane',
      collapsible:true,expanded:lucusSuggestionsOpen
    };
    const candidates=lucusSuggestionsOpen?suggestionAnalysis.suggestions.map(item=>({
      id:'suggested-lucus:'+item.date,entry_type:'virtual_lucus',
      group_key:candidateLane.id,group_label:'建議定錨點',group_order:9999,
      start_date:item.date,display_label:'◇',title:
        item.date+' · 前 3 日 '+item.beforeCount+' 篇／後 3 日 '+item.afterCount+' 篇 · '+
        (item.analysis||[]).join(' '),
      class_name:'scope-virtual-lucus',
      virtual_lucus:item
    })):[];
    return {...base,groups:[...base.groups,candidateLane],
      items:[...base.items,...candidates]};
  },[densityMode,keywordDaily,daily,catalog,expandedSources,rangeStart,rangeEnd,
    lucusSuggestionsOpen,suggestionAnalysis.suggestions]);
  useEffect(()=>{
    // Never keep a date selected when it is no longer a candidate.
    if(focusedSuggestionDate&&!suggestionAnalysis.suggestions.some(
      item=>item.date===focusedSuggestionDate))setFocusedSuggestionDate('');
  },[focusedSuggestionDate,suggestionAnalysis.suggestions]);
  const resetArticles=(site='',categoryKey='',sites=[])=>{
    articleAbortRef.current?.abort();articleAbortRef.current=null;
    sequence.current+=1;setSelectedSite(site);setSelectedSites(sites);setSelectedCategoryKey(categoryKey);setArticlesOpen(false);
    setArticleRows([]);setArticleOffset(0);setArticlePageStart(0);
    setArticleMore(false);setArticlesLoading(false);setArticleError('');fullSequence.current+=1;
    setFullUid('');setFullText('');setFullDetail(null);setFullError('');
  };
  const chooseEra=async value=>{
    densityAbortRef.current?.abort();
    prepareTransientResourceAction('period');
    resetArticles();setDaily(NO_ITEMS);setKeywordDaily(NO_ITEMS);
    setDensityReadyKey('');setKeywordReadyKey('');
    setExpandedSources([]);setLucusSuggestionsOpen(false);
    setFocusedSuggestionDate('');setHierarchyError('');setDensityPeriod(value);
    setPeriodChoices(NO_ITEMS);setSelectedPeriodUid('');setSelectedPeriodRange(null);
    setActiveTimeRows(NO_ITEMS);setExpandedEras(value==='year'||value==='custom'?[]:[value]);
    setPeriodsLoading(false);setPeriodDatesLoading(false);
    if(value==='year'||value==='custom'){
      hierarchySequence.current++;
      return;
    }
    const era=eraChoices.find(row=>String(row.uid)===value);
    if(!era)return;
    const request=++hierarchySequence.current;
    const periodUids=linkedUids(era,'period');
    if(!periodUids.length){
      setHierarchyError('此時代沒有可用的期間定錨點。');
      return;
    }
    setPeriodsLoading(true);
    try{
      const periods=await readTimeLucusByUid(scopeId,'period',periodUids,
        ()=>request===hierarchySequence.current);
      if(request!==hierarchySequence.current)return;
      const order=new Map(periodUids.map((uid,index)=>[uid,index]));
      const orderedPeriods=periods.sort((a,b)=>(order.get(String(a.uid))??Infinity)-
        (order.get(String(b.uid))??Infinity));
      setPeriodsLoading(false);
      setPeriodDatesLoading(true);
      const dateUids=orderedPeriods.flatMap(period=>linkedUids(period,'uid'));
      const dates=await readTimeLucusByUid(scopeId,'date',dateUids,
        ()=>request===hierarchySequence.current);
      if(request!==hierarchySequence.current)return;
      const validDates=dates.map(row=>({...row,date:datePart(attributes(row).date)}))
        .filter(row=>validDateKey(row.date));
      const windows=locEraWindows(era);
      const bounds=rangeBounds(windows);
      setPeriodChoices(orderedPeriods);
      setSelectedPeriodRange(bounds.start&&bounds.end?{...bounds,windows}:null);
      setActiveTimeRows(mergeTimeRows([era],orderedPeriods,validDates));
      setExpandedEras([String(era.uid)]);
      if(!bounds.start||!bounds.end)
        setHierarchyError('此時代尚未連結有效的時間定錨點。');
    }catch(reason){
      if(request===hierarchySequence.current)
        setHierarchyError(String(reason?.message||reason));
    }finally{
      if(request===hierarchySequence.current){
        setPeriodsLoading(false);
        setPeriodDatesLoading(false);
      }
    }
  };
  const choosePeriod=async value=>{
    densityAbortRef.current?.abort();
    prepareTransientResourceAction('period');
    resetArticles();setDaily(NO_ITEMS);setKeywordDaily(NO_ITEMS);
    setDensityReadyKey('');setExpandedSources([]);setLucusSuggestionsOpen(false);
    setFocusedSuggestionDate('');setHierarchyError('');setSelectedPeriodUid(value);
    setPeriodsLoading(false);
    setSelectedPeriodRange(null);setActiveTimeRows(NO_ITEMS);
    if(!value){hierarchySequence.current++;setPeriodDatesLoading(false);return;}
    const era=selectedEra,period=periodChoices.find(row=>String(row.uid)===value);
    if(!era||!period)return;
    const request=++hierarchySequence.current;
    setPeriodDatesLoading(true);
    try{
      const dates=await readTimeLucusByUid(scopeId,'date',linkedUids(period,'uid'),
        ()=>request===hierarchySequence.current);
      if(request!==hierarchySequence.current)return;
      const validDates=dates.map(row=>({...row,date:datePart(attributes(row).date)}))
        .filter(row=>validDateKey(row.date));
      const inlineDates=list(attributes(period).date||attributes(period).dates)
        .map(datePart).filter(validDateKey);
      const days=[...validDates.map(row=>row.date),...inlineDates].sort();
      const startDate=days[0]||'',endDate=days.at(-1)||'';
      const windows=startDate&&endDate?[{startDate,endDate}]:[];
      setSelectedPeriodRange(startDate&&endDate
        ?{start:startDate,end:endDate,windows}:null);
      setActiveTimeRows(mergeTimeRows([era,period],validDates));
      setExpandedEras([String(era.uid)]);
      if(!startDate)setHierarchyError('此期間尚未連結有效的時間定錨點。');
    }catch(reason){
      if(request===hierarchySequence.current)
        setHierarchyError(String(reason?.message||reason));
    }finally{
      if(request===hierarchySequence.current)setPeriodDatesLoading(false);
    }
  };
  const navigateEra=direction=>{
    if(loading||periodsLoading||periodDatesLoading||riverPending||!eraChoices.length)return;
    const nextIndex=activeEraIndex<0
      ?(direction==='previous'?0:-1)
      :direction==='previous'?activeEraIndex+1:activeEraIndex-1;
    if(nextIndex<0||nextIndex>=eraChoices.length)return;
    void chooseEra(String(eraChoices[nextIndex].uid));
  };
  const eraNavigationDisabled={
    previous:loading||periodsLoading||periodDatesLoading||riverPending
      ||!eraChoices.length||activeEraIndex>=eraChoices.length-1,
    next:loading||periodsLoading||periodDatesLoading||riverPending
      ||activeEraIndex<=0
  };
  const fetchArticles=async({offset=0,site=selectedSite,sites=selectedSites}={})=>{
    if(!scope||!site||densityMode!=='source'||!validRange)return;
    articleAbortRef.current?.abort();
    const controller=new AbortController();
    articleAbortRef.current=controller;
    const request=++sequence.current;
    // The old 100-row DIV is replaced by Loading before the next page,
    // freeing the previous article instances while the cursor survives.
    setArticleRows([]);setArticlesLoading(true);setArticleError('');
    try{
      const page=await selectCultureArticleListPage(scope,{
        startDate:rangeStart,endDate:rangeEnd,site,sites,offset,limit:CULTURE_ARTICLE_PAGE_SIZE,sortDirection:'desc',
        signal:controller.signal
      });
      if(request!==sequence.current)return;
      // One 100-row window at a time. The server cursor retains position;
      // old article objects are no longer held by this page.
      setArticleRows(page.rows);
      setArticlePageStart(offset);
      setArticleOffset(page.nextCursor?.offset||offset+page.rows.length);
      setArticleMore(page.hasMore);
    }catch(reason){
      if(request===sequence.current&&!controller.signal.aborted)
        setArticleError(String(reason?.message||reason));
    }finally{
      if(articleAbortRef.current===controller)articleAbortRef.current=null;
      if(request===sequence.current)setArticlesLoading(false);
    }
  };
  const openArticles=(site,categoryKey,sites=[])=>{
    if(densityMode!=='source')return;
    // Clear the previous category before the new bounded page is fetched.
    // The request sequence invalidates late responses from the old category.
    resetArticles(site,categoryKey,sites);
    setArticlesOpen(true);
    fetchArticles({site,sites,offset:0});
  };
  useEffect(()=>{
    // Any date/filter change invalidates visible details, held text, active
    // worker results and expanded Source rows from the previous period.
    articleAbortRef.current?.abort();articleAbortRef.current=null;
    sequence.current+=1;fullSequence.current+=1;
    setArticlesOpen(false);setArticleRows([]);setArticleOffset(0);setArticlePageStart(0);
    setArticleMore(false);setArticlesLoading(false);setArticleError('');
    setSelectedSite('');setSelectedSites(NO_ITEMS);setSelectedCategoryKey('');
    setFullUid('');setFullText('');setFullDetail(null);setFullError('');
    setExpandedSources([]);
    setLucusSuggestionsOpen(false);setFocusedSuggestionDate('');
  },[scopeId,rangeStart,rangeEnd,densityMode,keywordClass]);
  const changeArticlePage=nextOffset=>{
    if(!articlesOpen||!selectedSite||articlesLoading)return;
    const offset=Math.max(0,Math.floor(Number(nextOffset)||0));
    fullSequence.current+=1;setFullUid('');setFullText('');setFullDetail(null);setFullError('');
    fetchArticles({offset,sites:selectedSites});
  };
  const toggleFull=async row=>{
    const request=++fullSequence.current;
    if(fullUid===row.uid){setFullUid('');setFullText('');setFullDetail(null);return;}
    setFullUid(row.uid);setFullText('');setFullDetail(null);setFullError('');
    try{
      const detail=await selectGalaxyIdentity(scope,row.uid);
      if(request!==fullSequence.current)return;
      if(!detail)throw new Error('本文已隱藏');
      setFullText(String(detail.content||''));
      setFullDetail(detail);
    }catch(reason){
      if(request===fullSequence.current)setFullError(String(reason?.message||reason));
    }
  };
  return <FeaturePage featureId='culture'>
    <section className='loc-card scope-feature-card scope-feature-card-wide'>
      {loading?<div className='scope-culture-density-loading' role='status' aria-live='polite' aria-busy='true'>
        <span className='scope-culture-density-loading__bar' aria-hidden='true'/>
        <span>正在載入時間定錨…</span>
      </div>:null}
      <section className='scope-card scope-culture-classification-river scope-public-culture-panel scope-culture-dual-panel'>
        <div className='scope-culture-river-toolbar'><h3>文化時間長河</h3></div>
        <div className='scope-culture-river-selectors'>
          <label>時間範圍／時代
            <select className='scope-select' value={densityPeriod} onChange={event=>{
              void chooseEra(event.target.value);
            }}>
              <option value='year'>{DEFAULT_YEAR_WINDOW.label}</option>
              {eraChoices.map(row=><option key={row.uid} value={row.uid}>{row.title||row.uid}</option>)}
              <option value='custom'>自訂日期</option>
            </select>
          </label>
          {selectedEra?<label>期間
            <select className='scope-select' value={selectedPeriodUid}
              onChange={event=>void choosePeriod(event.target.value)}
              disabled={periodsLoading||periodDatesLoading}>
              <option value=''>選擇期間</option>
              {periodChoices.map(row=><option key={row.uid} value={row.uid}>{row.title||row.uid}</option>)}
            </select>
          </label>:null}
          {densityPeriod==='custom'?<>
            <label>起始日 <input type='date' className='scope-select' value={customStart} onChange={event=>{
              densityAbortRef.current?.abort();prepareTransientResourceAction('period');resetArticles();
              setDaily(NO_ITEMS);setDensityReadyKey('');setCustomStart(event.target.value);
            }}/></label>
            <label>結束日 <input type='date' className='scope-select' value={customEnd} onChange={event=>{
              densityAbortRef.current?.abort();prepareTransientResourceAction('period');resetArticles();
              setDaily(NO_ITEMS);setDensityReadyKey('');setCustomEnd(event.target.value);
            }}/></label>
          </>:null}
          <label>分類顯示
            <select className='scope-select' value={densityMode} onChange={event=>{setDensityMode(event.target.value);setExpandedSources([]);resetArticles('');}}>
              <option value='source'>文章來源</option><option value='keyword'>關鍵詞</option>
            </select>
          </label>
          {densityMode==='keyword'?<label>關鍵詞科目
            <select className='scope-select' value={keywordClass} onChange={event=>{setKeywordClass(event.target.value);setExpandedSources([]);}}>
              <option value=''>請選擇公開的關鍵詞科目</option>
              {keywordClasses.map(row=><option key={row.classUid} value={row.classUid}>{row.name||row.classUid}</option>)}
            </select>
          </label>:null}
        </div>
        {hierarchyError?<p className='scope-status scope-error' role='alert'>{hierarchyError}</p>:null}
        {periodsLoading?<p className='scope-status' role='status' aria-live='polite'>
          正在載入「{selectedEra?.title||'時代'}」的期間… <ActivityMotion kind='hourglass'/></p>:null}
        {periodDatesLoading?<p className='scope-status' role='status' aria-live='polite'>
          正在展開期間內的定錨點… <ActivityMotion kind='hourglass'/></p>:null}
        {selectedEra&&!periodsLoading&&!periodChoices.length&&!hierarchyError
          ?<p className='scope-status'>此時代目前沒有可選的期間。</p>:null}
        {selectedEra&&periodChoices.length&&!selectedPeriodUid&&!periodsLoading
          ?<p className='scope-status'>目前顯示整個時代；選擇期間可進一步縮小範圍。</p>:null}
        {densityPeriod==='custom'&&!validRange?<p className='scope-status scope-error' role='alert'>請選擇有效的起訖日期。</p>:null}
        {selectedPeriodUid&&!validRange&&!periodDatesLoading
          ?<p className='scope-status'>此期間沒有可用的日期範圍。</p>:null}
        {catalogLoading&&densityMode==='source'?<p className='scope-status' role='status'>
          正在載入來源分類…</p>:null}
        {catalogError&&densityMode==='source'?<p className='scope-status scope-error' role='alert'>
          來源分類暫時無法載入：{catalogError}</p>:null}
        {keywordError?<p className='scope-status scope-error' role='alert'>{keywordError}</p>:null}
        {riverPending?<div className='scope-culture-density-loading' role='status'
          aria-live='polite' aria-label='正在整理該時期的每日文章密度'>
          <span className='scope-culture-density-loading__bar' aria-hidden='true'/>
          <span>正在整理時間河道的每日密度… <ActivityMotion kind='numbers'/></span>
        </div>:null}
        {selectedPeriodUid&&validRange&&!riverPending&&periodStatisticsRows.length
          ?<section className='scope-card scope-culture-period-statistics' aria-label='期間文章統計'>
            <h4>{selectedEra?.title||'時代'} · {selectedPeriod?.title||'期間'}文章趨勢</h4>
            <CulturePeriodStatistics type='line' rows={periodStatisticsRows}
              series={[{key:'total',label:'文章篇數'}]} height={240}/>
          </section>:null}
        {!loading&&!hierarchyError&&lucusRiver.groups.length?
          <section className='scope-culture-structure-river scope-public-culture-panel'
            aria-label='時間定錨河道'>
            <div className='scope-culture-structure-toolbar'>
              <h3>時間定錨</h3>
              <span className='scope-status'>{timeRiverStart} ～ {timeRiverEnd}</span>
            </div>
            <div className='scope-culture-layer-legend' role='group' aria-label='時間定錨圖例'>
              <div className='scope-culture-layer-legend__time'>
                <span><i className='is-era' aria-hidden='true'/>時代</span>
                <span><i className='is-period' aria-hidden='true'/>期間</span>
                <span><i className='is-lucus' aria-hidden='true'/>時間定錨</span>
              </div>
            </div>
            <CultureTimeline items={lucusRiver.items} extraGroups={lucusRiver.groups}
              focus={NO_FOCUS} mode='trace'
              windowStart={timeRiverStart} windowEnd={timeRiverEnd}
              fixedMin={timeRiverStart} fixedMax={timeRiverEnd}
              onGroupToggle={group=>{
                const name=String(group);
                if(!name.startsWith('era:'))return;
                const uid=name.slice(4);
                setExpandedEras(old=>old.includes(uid)
                  ?old.filter(value=>value!==uid):[...old,uid]);
              }}/>
          </section>
          :!loading&&!hierarchyError?<p className='scope-status'>目前沒有時間定錨。</p>:null}
        {!riverPending&&validRange&&(densityMode!=='source'||(!catalogLoading&&!catalogError))?
          <section className='scope-culture-double-river scope-public-culture-river'
            aria-label='文章來源密度河道'>
            <div className='scope-culture-layer-legend' role='group' aria-label='文章密度圖例'>
              <div className='scope-culture-layer-legend__density' aria-label='單日文章數密度'>
                {TERRITORY_STOPS.map(([minimum],index)=>{
                  const maximum=TERRITORY_STOPS[index+1]?.[0];
                  const label=minimum===0?'1–2':maximum?`${minimum}–${maximum-1}`:`${minimum}+`;
                  return <span key={minimum}><i style={{background:territoryLegendColor(index)}} aria-hidden='true'/>{label} 篇</span>;
                })}
              </div>
            </div>
            <CultureTimeline items={densityRiver.items} extraGroups={densityRiver.groups}
              focus={NO_FOCUS} mode='source'
              heightVariant='double' naturalSourceHeight
              windowStart={rangeStart} windowEnd={rangeEnd}
              fixedMin={rangeStart} fixedMax={rangeEnd}
              onEraNavigate={eraChoices.length?direction=>navigateEra(direction):null}
              eraNavigationDisabled={eraNavigationDisabled}
              lucusInsight={selectedSuggestion?{
                date:selectedSuggestion.date,before:selectedSuggestion.beforeCount,
                after:selectedSuggestion.afterCount,reason:(selectedSuggestion.analysis||[]).join(' ')
              }:null}
              lucusLabels={{date:'建議日期',before:'前三日作品',after:'後三日作品',
                reason:'分析依據',close:'關閉'}}
              onLucusClose={()=>setFocusedSuggestionDate('')}
              onSelect={row=>{
                if(row?.entryType==='virtual_lucus')
                  setFocusedSuggestionDate(String(row.start||'').slice(0,10));
              }}
              onGroupToggle={group=>{
                const name=String(group);
                if(name==='root:lucus-suggestions'){
                  setLucusSuggestionsOpen(open=>!open);
                  setFocusedSuggestionDate('');
                  return;
                }
                if(densityMode==='source'&&name.startsWith('dual:source:')){
                  const uid=name.slice('dual:source:'.length);
                  startSourceExpansion(()=>setExpandedSources(old=>
                    old.includes(uid)?old.filter(value=>value!==uid):[...old,uid]));
                }else if(densityMode==='keyword'&&name.startsWith('root:')){
                  const id=name.slice(5);
                  startSourceExpansion(()=>setExpandedSources(old=>
                    old.includes(id)?old.filter(value=>value!==id):[...old,id]));
                }
              }}
              onGroupSelect={group=>{
                const name=String(group);
                if(!name.startsWith('dual:source:')||densityMode!=='source')return;
                const category=densityRiver.sites.find(item=>item.key===name);
                if(category)openArticles(category.site,category.key,category.sites);
              }}/>
          </section>:null}
        {sourceExpansionPending?<div className='scope-culture-density-loading' role='status'
          aria-live='polite' aria-busy='true'>
          <span className='scope-culture-density-loading__bar' aria-hidden='true'/>
          <span>正在整理來源分類… <ActivityMotion kind='numbers'/></span>
        </div>:null}
        {!riverPending&&lucusSuggestionsOpen?<div id='public-culture-lucus-analysis'
          className='scope-culture-lucus-actions' role='region'
          aria-label='建議定錨點分析'>
          {suggestionAnalysis.error?<p className='scope-status scope-error' role='alert'>
            {suggestionAnalysis.error}</p>:null}
          {selectedSuggestion?<div className='scope-culture-lucus-selection' role='status'>
            <strong>已選取建議日期：{selectedSuggestion.date}</strong>
            <ScopeLink href={scopeHref(scopeId,
              'culture/manage?edit=1&lucusDate='+encodeURIComponent(selectedSuggestion.date))}>
              將此日期帶入時間定錨編輯
            </ScopeLink>
            <span className='scope-status'>確認名稱及日期後，再按儲存才會建立。</span>
          </div>:null}
          {suggestionAnalysis.suggestions.length?<div className='scope-culture-lucus-choices'>
            {suggestionAnalysis.suggestions.map(item=><div key={item.date}
              className='scope-status'>
              <button type='button' className='loc-button'
                aria-pressed={focusedSuggestionDate===item.date}
                onClick={()=>setFocusedSuggestionDate(item.date)}>
                {item.date} · 前三日 {item.beforeCount} 篇／後三日 {item.afterCount} 篇
              </button>
              <ScopeLink href={scopeHref(scopeId,
                'culture/manage?edit=1&lucusDate='+encodeURIComponent(item.date))}>
                前往時間編輯
              </ScopeLink>
            </div>)}
          </div>:<p className='scope-status' role='status'>
            {candidateDensityRows.length&&!suggestionAnalysis.error
              ?'正在分析，或目前沒有符合條件的建議定錨點。'
              :'目前沒有可分析的每日作品資料。'}
          </p>}
          <p className='scope-status'>建議日期僅供參考，不會自動新增或修改時間定錨。</p>
        </div>:null}
        {densityMode==='keyword'&&keywordClass?<p className='scope-status'>每日關鍵詞密度來自詞級索引的實際 UID 命中，依日期統計並去重文章。</p>:null}
        {densityMode==='keyword'&&classesLoading?<p className='scope-status'>正在載入關鍵詞科目…</p>:null}
        {densityMode==='keyword'&&keywordLoading?<p className='scope-status'>正在載入關鍵詞統計…</p>:null}
        {densityMode==='keyword'&&!classesLoading&&!keywordClasses.length?<p className='scope-status'>目前沒有可使用的公開關鍵詞科目。</p>:null}
        {densityMode==='keyword'&&keywordClass&&!keywordLoading&&!keywordError&&!keywordGroups.length?<p className='scope-status'>此範圍沒有可顯示的關鍵詞統計。</p>:null}
      </section>
      {articlesOpen&&densityMode==='source'&&selectedSite?<section className='scope-card scope-culture-source-detail' data-selected-category={selectedCategoryKey}>
        <div className='scope-culture-source-detail-heading'>
          <h3>{articlePageStart===0
            ?'文章列表：前'+CULTURE_ARTICLE_PAGE_SIZE+'篇'
            :'文章列表：'+(articlePageStart+1)+'–'+(articlePageStart+articleRows.length)+'篇'}</h3>
          <button type='button' className='loc-button' onClick={()=>resetArticles()}>
            收合列表
          </button>
        </div>
        {articleError?<p role='alert' className='scope-status scope-error'>{articleError}</p>:null}
        <div className='loc-public-article-list scope-culture-source-work-scroll' aria-live='polite'>
          {articleRows.map((row,index)=>row.hidden
            ?<div className='scope-work-list-row' key={row.key||index}><span>本文已隱藏</span><time>{row.date}</time></div>
            :<div className='scope-work-list-row' key={row.key||index}>
              <button type='button' className='scope-article-title-link'
                disabled={row.extract!==true} onClick={()=>row.extract===true&&toggleFull(row)}>
                {row.title||'未命名文章'}
              </button>
              <time>{row.date}</time>
            </div>)}
        </div>
        {articlesLoading?<p className='scope-status' role='status' aria-live='polite'>
          載入文章列表中… <ActivityMotion kind='numbers'/></p>:null}
        {!articlesLoading&&articleRows.length?<nav className='scope-article-page-nav' aria-label='文章列表分頁'>
          <button type='button' className='loc-button' disabled={articlePageStart===0||articlesLoading}
            onClick={()=>changeArticlePage(Math.max(0,articlePageStart-CULTURE_ARTICLE_PAGE_SIZE))}>上一頁</button>
          <span>{articlePageStart+1}–{articlePageStart+articleRows.length}</span>
          <button type='button' className='loc-button' disabled={!articleMore||articlesLoading}
            onClick={()=>changeArticlePage(articleOffset)}>下一頁</button>
        </nav>:null}
        {!articlesLoading&&!articleRows.length&&!articleError
          ?<p className='scope-status'>沒有相關文章。</p>:null}
      </section>:null}
      {fullUid?<div className='loc-article-reader-backdrop' role='presentation' onMouseDown={event=>{
        if(event.target===event.currentTarget){fullSequence.current+=1;setFullUid('');setFullText('');setFullDetail(null);setFullError('');}
      }}>
        <section className='loc-article-reader' role='dialog' aria-modal='true' aria-label='文章內容'>
          <header><strong>文章內容</strong>
            <button type='button' className='loc-button' onClick={()=>{fullSequence.current+=1;setFullUid('');setFullText('');setFullDetail(null);setFullError('');}}>關閉</button>
          </header>
          {fullError?<p className='scope-status scope-error'>{fullError}</p>:null}
          {!fullText&&!fullError?<p className='scope-status' role='status'>正在載入文章…</p>:null}
          {fullDetail?<div className='loc-article-reader__body'>
            <Article uid={fullUid} title={fullDetail.title||articleRows.find(row=>row.uid===fullUid)?.title||'未命名文章'}
              articleHref={galaxyIdentityHref(scopeId,fullUid)}
              date={fullDetail.article_day||fullDetail.date||articleRows.find(row=>row.uid===fullUid)?.date||''}
              source={fullDetail.site||''} detailReading
              relationLinks={galaxyRelationLinks(scopeId,fullDetail)}
              relatedMedia={fullDetail.related_media||[]}
              relatedTime={fullDetail.related_time||null}
              relatedSpace={fullDetail.related_space||null}
              relatedStatistics={fullDetail.related_statistics||null}
              articleScopeId={scopeId}
              articleDate={fullDetail.article_day||fullDetail.date||''}
              articleCreateTime={fullDetail.createtime||''}
              tracePlace={fullDetail.trace_place||null}
              traceHref={fullDetail.trace_place
                ?featureNavigationHref(scopeId,'trace',{place:fullDetail.trace_place.uid}):''}
              locationName={fullDetail.location||''}
              links={fullDetail.links||[]}
              body={fullText} editOnCardClick={false}/>
            <ScopeLink className='loc-button' href={(()=>{
              const base=scopeHref(scopeId,'search/manage');
              return base+(base.includes('?')?'&':'?')+'identity='+encodeURIComponent(fullUid);
            })()}>編輯文章</ScopeLink>
          </div>:null}
        </section>
      </div>:null}
    </section>
  </FeaturePage>;
}


export default function CulturePublicReader(){
  const {scopeId}=useScopeRuntime();
  return scopeId==='loc'?<LocGroupCultureReader/>:<ScopeCulturePublicReader/>;
}
