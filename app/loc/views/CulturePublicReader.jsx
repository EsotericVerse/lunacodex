'use client';
import {useEffect,useMemo,useRef,useState,useTransition} from 'react';
import dynamic from 'next/dynamic';
import {useScopeRuntime} from '../../modular/use-scope-runtime';
import {FeaturePage} from '../../modular/ui';
import {selectRows} from '../db/db-query.mjs';
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
import {ANCHOR_TYPE_GROUPS} from '../../../packages/zenstack/anchor-hierarchy.mjs';
import {unassignedPublicDateAnchors} from '../culture/time-trace-river.mjs';
import {useRiverDensityAnalysis} from '../../modular/modules/culture-timeline/use-river-density-analysis';
import {prepareTransientResourceAction} from '../../../packages/zenstack/client-queries';
import ActivityMotion from '../../modular/ActivityMotion';
import {TERRITORY_STOPS,territoryLegendColor} from '../../modular/visual-palette.mjs';

const CultureTimeline=dynamic(()=>import('../../modular/modules/culture-timeline/CultureTimeline'),{
  loading:()=> <div className='scope-culture-density-loading' role='status' aria-busy='true'>
    <span className='scope-culture-density-loading__bar' aria-hidden='true'/>
    <span>正在準備時間長河…</span>
  </div>
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
function anchorModel(rows,start,end,expanded){
  // TimeAnchor links form a directed graph, not a single-parent tree:
  // the same date can legitimately belong to multiple periods/eras.
  // Use the frozen ZModel TimeAnchor discriminator and resolve its UID edges
  // directly; the tree-only hierarchy index rejects these valid shared dates.
  const all=list(rows).filter(row=>ANCHOR_TYPE_GROUPS.time.includes(row.type));
  const byUid=new Map(all.filter(row=>/^[A-Za-z0-9]{8}$/.test(String(row.uid||'')))
    .map(row=>[String(row.uid),row]));
  const dates=all.filter(row=>row.type==='date').map(row=>({
    ...row,date:datePart(attributes(row).date)
  })).filter(row=>validDateKey(row.date));
  const periodRange=row=>{
    const attr=attributes(row);
    const from=list(attr.date||attr.dates).map(datePart).filter(validDateKey);
    const links=list(attr.uid||attr.anchors).map(uid=>byUid.get(String(uid)))
      .filter(Boolean).map(item=>datePart(attributes(item).date)).filter(validDateKey);
    const allDates=[...from,...links].sort();
    return {start:allDates[0]||'',end:allDates[allDates.length-1]||''};
  };
  // The transport may return TimeAnchor rows by UID. Era/Period group
  // positions instead follow the earliest genuine linked DateAnchor.
  // UIDs are stable tie-breakers only, never chronological indicators.
  const eraStart=era=>{
    const attr=attributes(era);
    const periodDates=list(attr.period).map(id=>byUid.get(String(id)))
      .filter(row=>row?.type==='period')
      .map(row=>periodRange(row).start).filter(Boolean);
    const ownDates=list(attr.date||attr.dates).map(datePart).filter(Boolean);
    return [...periodDates,...ownDates].sort()[0]||'9999-12-31';
  };
  const eras=all.filter(row=>row.type==='era').sort((a,b)=>
    eraStart(a).localeCompare(eraStart(b))||
    String(a.uid).localeCompare(String(b.uid)));
  // The Culture river combines time structure and source density on one axis.
  // Era spans remain segmented by their real Period windows; date anchors get
  // a dedicated lane so they stay visible without opening a source branch.
  const groups=[],items=[],eraWindows=[];
  const eraChoices=[];
  for(const era of eras){
    const uid=String(era.uid),attr=attributes(era);
    const periodUids=list(attr.period).map(String)
      .filter(id=>/^[A-Za-z0-9]{8}$/.test(id));
    const refs=periodUids.map(id=>byUid.get(id))
      .filter(item=>item?.type==='period')
      .sort((a,b)=>
        (periodRange(a).start||'9999-12-31')
          .localeCompare(periodRange(b).start||'9999-12-31')||
        String(a.uid).localeCompare(String(b.uid)));
    const expandedEra=expanded.includes(uid);
    const ranges=refs.map(periodRange).filter(range=>range.start&&range.end);
    const eraDates=list(attr.date||attr.dates).map(datePart).filter(validDateKey).sort();
    // Classify every date using actual era/period windows even while collapsed.
    // Never use the era's outer envelope, which can cover unrelated dates.
    const windows=[...ranges.filter(range=>range.start&&range.end),
      ...eraDates.map(day=>({start:day,end:day}))];
    eraWindows.push(...windows);
    const begins=[...ranges.map(r=>r.start),...eraDates].filter(Boolean).sort();
    const ends=[...ranges.map(r=>r.end),...eraDates].filter(Boolean).sort();
    if(begins.length&&ends.length)eraChoices.push({uid,title:era.title||'時代',
      start_date:begins[0],end_date:ends[ends.length-1]});
    const intersects=windows.some(range=>range.end>=start&&range.start<=end);
    if(!intersects)continue;
    groups.push({id:'era:'+uid,label:era.title||'時代',
      collapsible:true,expanded:expanded.includes(uid),order:groups.length,
      className:'scope-culture-layer-era'});
    // Keep gaps between an Era's Periods visible. The Era row is a set of
    // real, merged intervals, never one invented first-to-last envelope.
    const eraSegments=[];
    for(const range of [...ranges,...eraDates.map(day=>({start:day,end:day}))]
      .filter(range=>range.start&&range.end)
      .sort((a,b)=>a.start.localeCompare(b.start)||a.end.localeCompare(b.end))){
      const previous=eraSegments.at(-1);
      const nextDay=previous?datePart(new Date(Date.parse(previous.end+'T00:00:00Z')+86400000).toISOString()):'';
      if(previous&&range.start<=nextDay){
        if(range.end>previous.end)previous.end=range.end;
      }else eraSegments.push({...range});
    }
    for(const [index,range] of eraSegments.entries()){
      if(range.end<start||range.start>end)continue;
      items.push({id:'era:'+uid+':segment:'+index,entry_type:'era',uid,
        title:era.title||'時代',group_key:'era:'+uid,
        group_label:era.title||'時代',start_date:range.start,
        ...(range.end>range.start?{end_date:range.end}:{}),era_uid:uid});
    }
    // Period rows open inside the same timeline, above the source lanes.
    if(!expandedEra)continue;
    refs.forEach(period=>{
      const id=String(period.uid),range=periodRange(period);
      if(!range.start||!range.end||range.end<start||range.start>end)return;
      groups.push({id:'period:'+uid+':'+id,label:'　'+(period.title||'期間'),order:groups.length,
        className:'scope-culture-layer-period'});
      items.push({id:'era:'+uid+':period:'+id,entry_type:'period',uid:id,
        title:period.title||'期間',group_key:'period:'+uid+':'+id,
        group_label:period.title||'期間',start_date:range.start,
        ...(range.end>range.start?{end_date:range.end}:{}),era_uid:uid,
        class_name:'scope-culture-period-range'});
    });
  }
  const inRange=dates.filter(row=>row.date>=start&&row.date<=end);
  const assigned=inRange.filter(row=>eraWindows.some(range=>
    row.date>=range.start&&row.date<=range.end));
  const unassigned=unassignedPublicDateAnchors(inRange,eraWindows);
  const addDateLane=(id,label,rows,className)=>{
    if(!rows.length)return;
    const order=groups.length;
    groups.push({id,label,order,className});
    for(const row of rows){
      const uid=String(row.uid);
      items.push({id:id+':'+uid,uid,entry_type:'anchor',
        title:row.title||row.date,display_label:'◆',start_date:row.date,
        group_key:id,group_label:label,
        class_name:'scope-time-original-anchor'});
    }
  };
  addDateLane('time-anchors','時間定錨',assigned,'scope-culture-layer-anchor');
  addDateLane('time-unassigned','未定義定錨',unassigned,'scope-culture-layer-unassigned');
  return {items,groups,eras:eraChoices};
}
// Source tree groups use the same LocAnchor UID hierarchy as the management
// editor and Statistics. Multimedia is a Universe, not a media-type pipeline.
// Keyword density has its own two-level Class/Group display. Source mode
// alone uses the full four-level published SiteAnchor hierarchy.
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
async function queryCultureData(scope,kind,start,end,signal=null){
  signal?.throwIfAborted?.();
  const params=new URLSearchParams({kind,scope});
  if(start)params.set('start',start);
  if(end)params.set('end',end);
  const {data}=await queryCultureContent(params.toString());
  signal?.throwIfAborted?.();
  return Array.isArray(data)?data:[];
}
export default function CulturePublicReader(){
  const {scopeId}=useScopeRuntime();
  const [sourceExpansionPending,startSourceExpansion]=useTransition();
  const scope=useMemo(()=>defaultScopeData(scopeId),[scopeId]);
  const start=DEFAULT_YEAR_WINDOW.startDate;
  const end=DEFAULT_YEAR_WINDOW.endDate;
  const [anchors,setAnchors]=useState(NO_ITEMS);
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
  const [error,setError]=useState('');
  const [catalogError,setCatalogError]=useState('');
  const [loading,setLoading]=useState(true);
  const [expandedEras,setExpandedEras]=useState([]);
  const [expandedSources,setExpandedSources]=useState([]);
  const [anchorSuggestionsOpen,setAnchorSuggestionsOpen]=useState(false);
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
  const allTimeRiver=useMemo(()=>anchorModel(anchors,'0001-01-01','9999-12-31',[]),[anchors]);
  const eraChoices=allTimeRiver.eras;
  const selectedEra=eraChoices.find(item=>item.uid===densityPeriod)||null;
  const rangeStart=densityPeriod==='custom'?customStart:selectedEra?.start_date||start;
  const rangeEnd=densityPeriod==='custom'?customEnd:selectedEra?.end_date||end;
  const validRange=/^\d{4}-\d{2}-\d{2}$/.test(rangeStart)&&
    /^\d{4}-\d{2}-\d{2}$/.test(rangeEnd)&&rangeStart<=rangeEnd;
  const densityKey=[scopeId,rangeStart,rangeEnd].join('|');
  const sourceDensityPending=densityMode==='source'&&validRange&&
    (densityLoading||densityReadyKey!==densityKey);
  const keywordDensityKey=[scopeId,keywordClass,rangeStart,rangeEnd].join('|');
  const keywordDensityPending=densityMode==='keyword'&&Boolean(keywordClass)&&
    (keywordLoading||keywordReadyKey!==keywordDensityKey);
  const riverPending=sourceDensityPending||keywordDensityPending;
  const sequence=useRef(0);
  const fullSequence=useRef(0);
  const densityAbortRef=useRef(null);
  const articleAbortRef=useRef(null);
  useEffect(()=>()=>{articleAbortRef.current?.abort();sequence.current++;fullSequence.current++;},[]);
  useEffect(()=>{
    let cancelled=false;
    setLoading(true);setError('');setCatalogError('');setCatalog(null);
    setCatalogLoading(true);setAnchors([]);
    // A SiteAnchor taxonomy failure must NEVER blank the independent
    // TimeAnchor river. These are separate, non-joined ZModel reads.
    queryCultureData(scopeId,'culture_anchors','','')
      .then(time=>{if(!cancelled){setAnchors(time);setLoading(false);}})
      .catch(reason=>{if(!cancelled){setError(String(reason?.message||reason));setLoading(false);}});
    readPublicSourceTaxonomy()
      .then(types=>{if(!cancelled){setCatalog(types);setCatalogError('');}})
      .catch(reason=>{if(!cancelled){
        // A failed request is NOT an empty taxonomy.
        setCatalog(null);
        setCatalogError(String(reason?.message||reason));
      }})
      .finally(()=>{if(!cancelled)setCatalogLoading(false);});
    return()=>{cancelled=true};
  },[scopeId]);
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
    queryCultureData(scopeId,'culture_density',rangeStart,rangeEnd,controller.signal)
      .then(rows=>{
        if(!active||controller.signal.aborted)return;
        setDaily(rows);setDensityReadyKey(densityKey);
      })
      .catch(error=>{
        if(!active||controller.signal.aborted||error?.name==='AbortError')return;
        setKeywordError(String(error?.message||error));setDensityReadyKey(densityKey);
      })
      .finally(()=>{if(active)setDensityLoading(false);});
    return()=>{active=false;controller.abort();
      if(densityAbortRef.current===controller)densityAbortRef.current=null;};
  },[scopeId,rangeStart,rangeEnd,validRange,densityMode]);
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
          .filter(row=>row.kind==='class_day')
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
  },[scopeId,densityMode,keywordClass,rangeStart,rangeEnd]);
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
  // The time layers cover the complete authored history; the source query
  // stays bounded to its selected period. Both are drawn on one time axis.
  const anchorRiver=useMemo(()=>expandedEras.length
    ?anchorModel(anchors,'0001-01-01','9999-12-31',expandedEras):allTimeRiver,
  [anchors,expandedEras,allTimeRiver]);
  // Reuse the saved DateAnchor history to exclude already-covered dates.
  // Suggestions are virtual until explicitly saved in the protected editor.
  const existingAnchorDates=useMemo(()=>anchors
    .filter(row=>row.type==='date')
    .map(row=>datePart(attributes(row).date)).filter(Boolean),[anchors]);
  const candidateDensityRows=densityMode==='keyword'?keywordDaily:daily;
  // Run Karaul/PELT only when the visitor opens the permanent suggestion
  // lane. Reuse the daily rows already fetched for the second river.
  const suggestionAnalysis=useRiverDensityAnalysis(candidateDensityRows,
    existingAnchorDates,anchorSuggestionsOpen&&validRange&&candidateDensityRows.length>0);
  const selectedSuggestion=suggestionAnalysis.suggestions.find(
    item=>item.date===focusedSuggestionDate)||null;
  const densityRiver=useMemo(()=>{
    const base=densityMode==='keyword'
      ?keywordSourceModel(keywordDaily,expandedSources,rangeStart,rangeEnd)
      :catalog?publicCultureSourceModel(daily,catalog,expandedSources,rangeStart,rangeEnd)
        :{items:[],groups:[],sites:[]};
    const candidateLane={
      id:'root:anchor-suggestions',label:anchorSuggestionsOpen
        ?'建議定錨點（'+suggestionAnalysis.suggestions.length+'）':'建議定錨點',
      order:9999,className:'scope-candidate-lane',
      collapsible:true,expanded:anchorSuggestionsOpen
    };
    const candidates=anchorSuggestionsOpen?suggestionAnalysis.suggestions.map(item=>({
      id:'suggested-anchor:'+item.date,entry_type:'virtual_anchor',
      group_key:candidateLane.id,group_label:'建議定錨點',group_order:9999,
      start_date:item.date,display_label:'◇',title:
        item.date+' · 前 3 日 '+item.beforeCount+' 篇／後 3 日 '+item.afterCount+' 篇 · '+
        (item.analysis||[]).join(' '),
      class_name:'scope-virtual-anchor',
      virtual_anchor:item
    })):[];
    return {...base,groups:[...base.groups,candidateLane],
      items:[...base.items,...candidates]};
  },[densityMode,keywordDaily,daily,catalog,expandedSources,rangeStart,rangeEnd,
    anchorSuggestionsOpen,suggestionAnalysis.suggestions]);
  const unifiedRiver=useMemo(()=>{
    const sourceOrder=anchorRiver.groups.length+2;
    const groups=[...anchorRiver.groups,...densityRiver.groups.map((group,index)=>({
      ...group,order:sourceOrder+(Number.isFinite(Number(group.order))?Number(group.order):index),
      className:[group.className,'scope-culture-source-layer'].filter(Boolean).join(' ')
    }))];
    const sourceItems=densityRiver.items.map(item=>({
      ...item,group_order:sourceOrder+(Number(item.group_order)||0)
    }));
    return {groups,items:[...anchorRiver.items,...sourceItems]};
  },[anchorRiver,densityRiver]);
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
    setAnchorSuggestionsOpen(false);setFocusedSuggestionDate('');
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
      {error?<p className='scope-status scope-error' role='alert'>{error}</p>:null}
      <section className='scope-card scope-culture-classification-river scope-public-culture-panel scope-culture-unified-panel'>
        <div className='scope-culture-river-toolbar'><h3>文化時間長河</h3></div>
        <div className='scope-culture-river-selectors'>
          <label>時代／時期範圍
            <select className='scope-select' value={densityPeriod} onChange={event=>{
              // The largest action takes priority: abort the old SQL BEFORE
              // re-render, retire expired spool, and replace the chart with Loading.
              const period=event.target.value;
              densityAbortRef.current?.abort();
              prepareTransientResourceAction('period');
              resetArticles();setDaily(NO_ITEMS);setKeywordDaily(NO_ITEMS);
              setDensityReadyKey('');setExpandedSources([]);setAnchorSuggestionsOpen(false);
              setFocusedSuggestionDate('');setDensityPeriod(period);
              setExpandedEras(eraChoices.some(row=>row.uid===period)?[period]:[]);
            }}>
              <option value='year'>{DEFAULT_YEAR_WINDOW.label}</option>
              {eraChoices.map(row=><option key={row.uid} value={row.uid}>{row.title}</option>)}
              <option value='custom'>自訂日期</option>
            </select>
          </label>
          {densityPeriod==='custom'?<>
            <label>起始日 <input type='date' className='scope-select' value={customStart} onChange={event=>{densityAbortRef.current?.abort();prepareTransientResourceAction('period');resetArticles();setDaily(NO_ITEMS);setDensityReadyKey('');setCustomStart(event.target.value);}}/></label>
            <label>結束日 <input type='date' className='scope-select' value={customEnd} onChange={event=>{densityAbortRef.current?.abort();prepareTransientResourceAction('period');resetArticles();setDaily(NO_ITEMS);setDensityReadyKey('');setCustomEnd(event.target.value);}}/></label>
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
        {!validRange?<p className='scope-status scope-error' role='alert'>請選擇有效的起訖日期。</p>:null}
        {catalogLoading&&densityMode==='source'?<p className='scope-status' role='status'>
          正在載入來源分類…</p>:null}
        {catalogError&&densityMode==='source'?<p className='scope-status scope-error' role='alert'>
          來源分類暫時無法載入：{catalogError}</p>:null}
        {keywordError?<p className='scope-status scope-error' role='alert'>{keywordError}</p>:null}
        {riverPending?<div className='scope-culture-density-loading' role='status'
          aria-live='polite' aria-label='正在整理該時期的每日文章密度'>
          <span className='scope-culture-density-loading__bar' aria-hidden='true'/>
          <span>正在整理時間河道的每日密度…</span>
        </div>:null}
        {!loading&&!error&&!riverPending&&(densityMode!=='source'||(!catalogLoading&&!catalogError))?
          <div className='scope-culture-double-river scope-public-culture-river scope-culture-unified-river'>
        <div className='scope-culture-layer-legend' role='group' aria-label='時間與文章密度圖例'>
          <div className='scope-culture-layer-legend__time'>
            <span><i className='is-era' aria-hidden='true'/>時代</span>
            <span><i className='is-period' aria-hidden='true'/>期間</span>
            <span><i className='is-anchor' aria-hidden='true'/>時間定錨</span>
          </div>
          <div className='scope-culture-layer-legend__density' aria-label='單日文章數密度'>
            {TERRITORY_STOPS.map(([minimum],index)=>{
              const maximum=TERRITORY_STOPS[index+1]?.[0];
              const label=minimum===0?'1–2':maximum?`${minimum}–${maximum-1}`:`${minimum}+`;
              return <span key={minimum}><i style={{background:territoryLegendColor(index)}} aria-hidden='true'/>{label} 篇</span>;
            })}
          </div>
        </div>
        <CultureTimeline items={unifiedRiver.items} eraRanges={anchorRiver.items}
          extraGroups={unifiedRiver.groups} focus={NO_FOCUS} mode='source'
          heightVariant='double' naturalSourceHeight stackItems
          windowStart={densityPeriod==='year'?'':rangeStart}
          windowEnd={densityPeriod==='year'?'':rangeEnd}
          anchorInsight={selectedSuggestion?{
            date:selectedSuggestion.date,before:selectedSuggestion.beforeCount,
            after:selectedSuggestion.afterCount,reason:(selectedSuggestion.analysis||[]).join(' ')
          }:null}
          anchorLabels={{date:'建議日期',before:'前三日作品',after:'後三日作品',
            reason:'分析依據',close:'關閉'}}
          onAnchorClose={()=>setFocusedSuggestionDate('')}
          onSelect={row=>{
            if(row?.entryType==='virtual_anchor')
              setFocusedSuggestionDate(String(row.start||'').slice(0,10));
          }}
          onGroupToggle={group=>{
            const name=String(group);
            if(name.startsWith('era:')){
              const uid=name.slice(4);
              if(eraChoices.some(row=>row.uid===uid))
                setExpandedEras(old=>old.includes(uid)?old.filter(x=>x!==uid):[...old,uid]);
              return;
            }
            if(name==='root:anchor-suggestions'){
              setAnchorSuggestionsOpen(open=>!open);
              setFocusedSuggestionDate('');
              return;
            }
            if(densityMode==='source'&&name.startsWith('dual:source:')){
              // Any saved ancestor may open the next UID level. Daily buckets
              // are already in memory; no article query is made on toggle.
              const uid=name.slice('dual:source:'.length);
              startSourceExpansion(()=>setExpandedSources(old=>old.includes(uid)?old.filter(x=>x!==uid):[...old,uid]));
            }else if(densityMode==='keyword'&&name.startsWith('root:')){
              const id=name.slice(5);
              startSourceExpansion(()=>setExpandedSources(old=>old.includes(id)?old.filter(x=>x!==id):[...old,id]));
            }
          }}
          onGroupSelect={group=>{
            const name=String(group);
            if(!name.startsWith('dual:source:')||densityMode!=='source')return;
            const category=densityRiver.sites.find(item=>item.key===name);
            if(category)openArticles(category.site,category.key,category.sites);
          }}/>
        </div>:null}
        {sourceExpansionPending?<div className='scope-culture-density-loading' role='status'
          aria-live='polite' aria-busy='true'>
          <span className='scope-culture-density-loading__bar' aria-hidden='true'/>
          <span>正在整理來源分類… <ActivityMotion kind='numbers'/></span>
        </div>:null}
        {!riverPending&&anchorSuggestionsOpen?<div id='public-culture-anchor-analysis'
          className='scope-culture-anchor-actions' role='region'
          aria-label='建議定錨點分析'>
          {suggestionAnalysis.error?<p className='scope-status scope-error' role='alert'>
            {suggestionAnalysis.error}</p>:null}
          {selectedSuggestion?<div className='scope-culture-anchor-selection' role='status'>
            <strong>已選取建議日期：{selectedSuggestion.date}</strong>
            <ScopeLink href={scopeHref(scopeId,
              'culture/manage?edit=1&anchorDate='+encodeURIComponent(selectedSuggestion.date))}>
              將此日期帶入時間定錨編輯
            </ScopeLink>
            <span className='scope-status'>確認名稱及日期後，再按儲存才會建立。</span>
          </div>:null}
          {suggestionAnalysis.suggestions.length?<div className='scope-culture-anchor-choices'>
            {suggestionAnalysis.suggestions.map(item=><div key={item.date}
              className='scope-status'>
              <button type='button' className='loc-button'
                aria-pressed={focusedSuggestionDate===item.date}
                onClick={()=>setFocusedSuggestionDate(item.date)}>
                {item.date} · 前三日 {item.beforeCount} 篇／後三日 {item.afterCount} 篇
              </button>
              <ScopeLink href={scopeHref(scopeId,
                'culture/manage?edit=1&anchorDate='+encodeURIComponent(item.date))}>
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
