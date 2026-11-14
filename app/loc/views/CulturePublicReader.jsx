'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import dynamic from 'next/dynamic';
import {useScopeRuntime} from '../../modular/use-scope-runtime';
import {FeaturePage} from '../../modular/ui';
import {selectRows} from '../db-query.mjs';
import {dbPublicClient} from '../db-client.mjs';
import {defaultScopeData} from '../scope-data';
import {selectCultureArticleListPage} from '../culture-query';
import {selectGalaxyIdentity} from '../galaxy-query';
import ScopeLink from '../../modular/ScopeLink';
import {scopeHref} from '../../modular/scope-registry';
import {assignedSource} from '../member-intersection-model.mjs';
import {readPublicSourceTaxonomy} from '../source-catalog-public.mjs';
import {DEFAULT_YEAR_WINDOW} from '../default-year-window.mjs';
import {ANCHOR_TYPE_GROUPS} from '../../../zenstack/anchor-hierarchy.mjs';
import {useRiverDensityAnalysis} from '../../modular/modules/culture-timeline/use-river-density-analysis';

const CultureTimeline=dynamic(()=>import('../../modular/modules/culture-timeline/CultureTimeline'),{loading:()=>null});
const NO_ITEMS=Object.freeze([]);
const NO_FOCUS=Object.freeze({});
const datePart=value=>String(value||'').slice(0,10);
// Initial camera is a *rolling* twelve months, not the complete history
// and not the fixed Jan-Dec interval used by the article-density river.
// Compute in Taiwan calendar dates so server/browser zones agree.
export function publicTimeRiverRecentYear(date=new Date()){
  const now=new Date(date);
  if(!Number.isFinite(now.getTime()))throw new RangeError('Invalid Time River date');
  const tw=new Date(now.getTime()+8*60*60*1000);
  const end=tw.toISOString().slice(0,10);
  tw.setUTCFullYear(tw.getUTCFullYear()-1);
  return {start:tw.toISOString().slice(0,10),end};
}
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
  })).filter(row=>row.date);
  const eras=all.filter(row=>row.type==='era');
  const periodRange=row=>{
    const attr=attributes(row);
    const from=list(attr.date||attr.dates).map(datePart).filter(Boolean);
    const links=list(attr.uid||attr.anchors).map(uid=>byUid.get(String(uid)))
      .filter(Boolean).map(item=>datePart(attributes(item).date)).filter(Boolean);
    const allDates=[...from,...links].sort();
    return {start:allDates[0]||'',end:allDates[allDates.length-1]||''};
  };
  // The first river is an era tree: collapsed rows contain only eras.
  // Date anchors belong to their eras, never to a separate sidebar lane.
  const groups=[],items=[];
  for(const era of eras){
    const uid=String(era.uid),attr=attributes(era);
    const periodUids=list(attr.period).map(String)
      .filter(id=>/^[A-Za-z0-9]{8}$/.test(id));
    const refs=periodUids.map(id=>byUid.get(id))
      .filter(item=>item?.type==='period');
    const expandedEra=expanded.includes(uid);
    groups.push({id:'era:'+uid,label:era.title||'時代',
      collapsible:true,expanded:expandedEra,order:groups.length});
    const ranges=refs.map(periodRange);
    const eraDates=list(attr.date||attr.dates).map(datePart).filter(Boolean).sort();
    const begins=[...ranges.map(r=>r.start),...eraDates].filter(Boolean).sort();
    const ends=[...ranges.map(r=>r.end),...eraDates].filter(Boolean).sort();
    if(begins.length&&ends.length&&ends[ends.length-1]>=start&&begins[0]<=end){
      items.push({id:'era:'+uid,entry_type:'era',uid,title:era.title||'時代',
        group_key:'era:'+uid,group_label:era.title||'時代',
        start_date:begins[0],end_date:ends[ends.length-1]});
    }
    // Collapsed eras show only the structural envelope. Generate
    // individual dates and sub-periods after the user expands that era.
    if(!expandedEra)continue;
    // Match real date points against each era's own periods. Do not use
    // the era's overall first/last date for matching: eras may have gaps.
    const windows=[...ranges.filter(range=>range.start&&range.end),
      ...eraDates.map(day=>({start:day,end:day}))];
    for(const row of dates){
      if(row.date<start||row.date>end||
        !windows.some(range=>row.date>=range.start&&row.date<=range.end))continue;
      const pointUid=String(row.uid);
      items.push({id:'era:'+uid+':date:'+pointUid,uid:pointUid,entry_type:'anchor',
        start_date:row.date,title:row.title||row.date,display_label:'',
        group_key:'era:'+uid,group_label:era.title||'時代'});
    }
    refs.forEach(period=>{
      const id=String(period.uid),range=periodRange(period);
      groups.push({id:'period:'+uid+':'+id,label:'　'+(period.title||'期間'),order:groups.length});
      if(range.start&&range.end&&range.end>=start&&range.start<=end){
        items.push({id:'era:'+uid+':period:'+id,entry_type:'period',uid:id,
          title:period.title||'期間',group_key:'period:'+uid+':'+id,
          group_label:period.title||'期間',
          start_date:range.start,end_date:range.end});
      }
    });
  }
  return {items,groups};
}
// Source tree groups use the same LocAnchor UID hierarchy as the management
// editor and Statistics. Multimedia is a Universe, not a media-type pipeline.
function sourceModel(rows,taxonomy,expanded,start,end){
  // The database already GROUPs articles by day/source. Keep the browser
  // aggregation linear in those grouped rows: a long era may contain 10k+
  // articles, but expanding ONE category must not rescan every other source
  // once per row or copy the raw article list into memory.
  const sourceRows=list(rows);
  const bySite=new Map(),countBySite=new Map();
  let max=1;
  for(const row of sourceRows){
    const name=String(row.site||''),count=Number(row.item_count)||0;
    if(!bySite.has(name))bySite.set(name,[]);
    bySite.get(name).push(row);
    countBySite.set(name,(countBySite.get(name)||0)+count);
    if(count>max)max=count;
  }
  const names=[...bySite.keys()];
  const categories=taxonomy?.categories||[],aliases=taxonomy?.aliases||[];
  const tree=taxonomy?.tree||[];
  const byUid=new Map(tree.map(row=>[row.uid,row]));
  const codeBySite=new Map(names.map(name=>[name,assignedSource(name,aliases,categories)]));
  const roots=taxonomy?(taxonomy.roots||[]).map(node=>{
    const descendants=new Set(tree
      .filter(row=>row.path?.[0]===node.uid).map(row=>row.uid));
    const sites=names.filter(site=>descendants.has(codeBySite.get(site)));
    const labels=new Map(sites.map(site=>{
      const entry=byUid.get(codeBySite.get(site));
      const parts=entry?.type==='from'?[entry.galaxy,entry.domain,entry.title]:
        entry?.type==='domain'?[entry.galaxy,entry.title]:[site];
      return [site,parts.filter(Boolean).join(' / ')];
    }));
    return {id:'source:'+node.uid,label:node.title,sites,labels};
  }).filter(node=>node.sites.length):[
    {id:'keyword',label:'關鍵詞',sites:names,labels:new Map()}
  ];
  if(taxonomy){
    const claimed=new Set(roots.flatMap(root=>root.sites));
    const unmatched=names.filter(site=>!claimed.has(site));
    if(unmatched.length)roots.push({
      id:'source:others',label:'未分類',sites:unmatched,labels:new Map()
    });
  }
  const groups=[],items=[],sites=[];
  for(const root of roots){
    const total=root.sites.reduce((count,site)=>count+(countBySite.get(site)||0),0);
    const opened=expanded.includes(root.id);
    groups.push({id:'root:'+root.id,label:root.label+' ('+total+')',
      collapsible:true,expanded:opened,order:groups.length});
    if(!opened){
      const daily=new Map();
      for(const site of root.sites)for(const row of bySite.get(site)||[]){
        if(row.day<start||row.day>end)continue;
        daily.set(row.day,(daily.get(row.day)||0)+Number(row.item_count||0));
      }
      for(const [day,count] of daily){
        items.push({id:'root:'+root.id+':'+day,entry_type:'source_total',
          group_key:'root:'+root.id,group_label:root.label,start_date:day,
          item_count:count,density_ratio:count/max,display_label:'',title:day+' · '+count});
      }
      continue;
    }
    for(const site of root.sites){
      const label=root.labels.get(site)||site,key=root.id+':'+site;
      const count=countBySite.get(site)||0;
      groups.push({id:'site:'+key,label:'　'+label+' ('+count+')',
        selectable:true,order:groups.length});
      sites.push({key,site,root:root.id,count,label});
      for(const row of bySite.get(site)||[]){
        if(row.day<start||row.day>end)continue;
        items.push({id:'site:'+key+':'+row.day,entry_type:'source',
          group_key:'site:'+key,group_label:label,start_date:row.day,
          item_count:Number(row.item_count||0),density_ratio:Number(row.item_count||0)/max,
          display_label:'',title:row.day+' · '+label+' · '+row.item_count});
      }
    }
  }
  return {items,groups,sites};
}
async function analytics(scope,view,start,end,options={}){
  const {data,error}=await dbPublicClient.schema('silver').analytics({
    p_scope_id:scope,p_view:view,p_start:start,p_end:end,p_options:options
  });
  if(error)throw new Error(error.message||'文化資料讀取失敗');
  return Array.isArray(data)?data:[];
}
export default function CulturePublicReader(){
  const {scopeId}=useScopeRuntime();
  const scope=useMemo(()=>defaultScopeData(scopeId),[scopeId]);
  const start=DEFAULT_YEAR_WINDOW.startDate;
  const end=DEFAULT_YEAR_WINDOW.endDate;
  const recentTimeWindow=useMemo(()=>publicTimeRiverRecentYear(),[]);
  const [anchors,setAnchors]=useState(NO_ITEMS);
  const [densityPeriod,setDensityPeriod]=useState('year');
  const [densityMode,setDensityMode]=useState('source');
  const [keywordClass,setKeywordClass]=useState('');
  const [keywordClasses,setKeywordClasses]=useState(NO_ITEMS);
  const [keywordGroups,setKeywordGroups]=useState(NO_ITEMS);
  const [keywordDaily,setKeywordDaily]=useState(NO_ITEMS);
  const [keywordLoading,setKeywordLoading]=useState(false);
  const [customStart,setCustomStart]=useState('');
  const [customEnd,setCustomEnd]=useState('');
  const [keywordError,setKeywordError]=useState('');
  const [classesLoading,setClassesLoading]=useState(false);
  const [daily,setDaily]=useState(NO_ITEMS);
  const [densityLoading,setDensityLoading]=useState(false);
  const [catalog,setCatalog]=useState({categories:[],aliases:[],tree:[],roots:[]});
  const [error,setError]=useState('');
  const [catalogError,setCatalogError]=useState('');
  const [loading,setLoading]=useState(true);
  const [expandedEras,setExpandedEras]=useState([]);
  const [expandedSources,setExpandedSources]=useState([]);
  const [anchorSuggestionsOpen,setAnchorSuggestionsOpen]=useState(false);
  const [focusedSuggestionDate,setFocusedSuggestionDate]=useState('');
  const [selectedSite,setSelectedSite]=useState('');
  const [selectedCategoryKey,setSelectedCategoryKey]=useState('');
  const [articleRows,setArticleRows]=useState([]);
  const [articleOffset,setArticleOffset]=useState(0);
  const [articleMore,setArticleMore]=useState(false);
  const [articlesOpen,setArticlesOpen]=useState(false);
  const [articlesLoading,setArticlesLoading]=useState(false);
  const [articleError,setArticleError]=useState('');
  const [fullUid,setFullUid]=useState('');
  const [fullText,setFullText]=useState('');
  const [fullError,setFullError]=useState('');
  const eraChoices=useMemo(()=>anchorModel(anchors,'0001-01-01','9999-12-31',[]).items
    .filter(item=>item.entry_type==='era'&&item.start_date&&item.end_date),[anchors]);
  const selectedEra=eraChoices.find(item=>item.uid===densityPeriod)||null;
  const rangeStart=densityPeriod==='custom'?customStart:selectedEra?.start_date||start;
  const rangeEnd=densityPeriod==='custom'?customEnd:selectedEra?.end_date||end;
  const validRange=/^\d{4}-\d{2}-\d{2}$/.test(rangeStart)&&
    /^\d{4}-\d{2}-\d{2}$/.test(rangeEnd)&&rangeStart<=rangeEnd;
  const sequence=useRef(0);
  const fullSequence=useRef(0);
  useEffect(()=>{
    let cancelled=false;
    setLoading(true);setError('');setCatalogError('');setAnchors([]);
    // A SiteAnchor taxonomy failure must NEVER blank the independent
    // TimeAnchor river. These are separate, non-joined ZModel reads.
    analytics(scopeId,'culture_anchors',null,null)
      .then(time=>{if(!cancelled){setAnchors(time);setLoading(false);}})
      .catch(reason=>{if(!cancelled){setError(String(reason?.message||reason));setLoading(false);}});
    readPublicSourceTaxonomy()
      .then(types=>{if(!cancelled)setCatalog(types);})
      .catch(reason=>{if(!cancelled){
        setCatalog({categories:[],aliases:[],tree:[],roots:[]});
        setCatalogError(String(reason?.message||reason));
      }});
    return()=>{cancelled=true};
  },[scopeId]);
  useEffect(()=>{
    let active=true;
    // Free the previous period's daily arrays before starting a new aggregate.
    // The SQL side returns one row per date/source, never 10k article bodies.
    setDaily(NO_ITEMS);
    setDensityLoading(validRange);
    setKeywordError('');
    if(!validRange)return()=>{active=false;};
    analytics(scopeId,'culture_density',rangeStart,rangeEnd)
      .then(rows=>{if(active)setDaily(rows);})
      .catch(error=>{if(active)setKeywordError(String(error?.message||error));})
      .finally(()=>{if(active)setDensityLoading(false);});
    return()=>{active=false;};
  },[scopeId,rangeStart,rangeEnd,validRange]);
  useEffect(()=>{
    // Release old class snapshots when switching tabs, subjects or dates.
    if(densityMode!=='keyword'||!keywordClass){
      setKeywordGroups(NO_ITEMS);setKeywordDaily(NO_ITEMS);setKeywordLoading(false);
      return undefined;
    }
    let active=true;
    setKeywordGroups(NO_ITEMS);setKeywordDaily(NO_ITEMS);
    setKeywordLoading(true);
    import('../keyword-service-client.mjs')
      .then(({keywordService})=>keywordService('stats',{
        scopeId,classUid:keywordClass,startDate:rangeStart,endDate:rangeEnd
      }))
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
      }).catch(error=>{if(active)setKeywordError(String(error?.message||error));})
      .finally(()=>{if(active)setKeywordLoading(false);});
    return()=>{active=false;};
  },[scopeId,densityMode,keywordClass,rangeStart,rangeEnd]);
  useEffect(()=>{
    if(densityMode!=='keyword'){
      setKeywordClasses(NO_ITEMS);setClassesLoading(false);
      return undefined;
    }
    let active=true;
    setClassesLoading(true);
    import('../keyword-service-client.mjs')
      .then(({keywordService})=>keywordService('classes',{scopeId}))
      .then(result=>{if(active)setKeywordClasses(result?.classes||[]);})
      .catch(error=>{if(active)setKeywordError(String(error?.message||error));})
      .finally(()=>{if(active)setClassesLoading(false);});
    return()=>{active=false;};
  },[scopeId,densityMode]);
  // The structural river spans all historical eras. The annual date window
  // applies only to the separate article-density river below.
  const structureStart=eraChoices.length
    ?eraChoices.reduce((min,row)=>row.start_date<min?row.start_date:min,eraChoices[0].start_date)
    :start;
  const structureEnd=eraChoices.length
    ?eraChoices.reduce((max,row)=>row.end_date>max?row.end_date:max,eraChoices[0].end_date)
    :end;
  const anchorRiver=useMemo(()=>anchorModel(anchors,structureStart,structureEnd,expandedEras),
    [anchors,structureStart,structureEnd,expandedEras]);
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
      ?sourceModel(keywordDaily,null,expandedSources,rangeStart,rangeEnd)
      :sourceModel(daily,catalog,expandedSources,rangeStart,rangeEnd);
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
  useEffect(()=>{
    // Never keep a date selected when it is no longer a candidate.
    if(focusedSuggestionDate&&!suggestionAnalysis.suggestions.some(
      item=>item.date===focusedSuggestionDate))setFocusedSuggestionDate('');
  },[focusedSuggestionDate,suggestionAnalysis.suggestions]);
  const resetArticles=(site='',categoryKey='')=>{
    sequence.current+=1;setSelectedSite(site);setSelectedCategoryKey(categoryKey);setArticlesOpen(false);
    setArticleRows([]);setArticleOffset(0);
    setArticleMore(false);setArticleError('');fullSequence.current+=1;
    setFullUid('');setFullText('');setFullError('');
  };
  const fetchArticles=async({append=false,offset=0,site=selectedSite}={})=>{
    if(!scope||!site||densityMode!=='source'||!validRange)return;
    const request=++sequence.current;
    setArticlesLoading(true);setArticleError('');
    try{
      const page=await selectCultureArticleListPage(scope,{
        startDate:rangeStart,endDate:rangeEnd,site,offset,sortDirection:'desc'
      });
      if(request!==sequence.current)return;
      setArticleRows(old=>append?[...old,...page.rows]:page.rows);
      setArticleOffset(page.nextCursor?.offset||offset+page.rows.length);
      setArticleMore(page.hasMore);
    }catch(reason){if(request===sequence.current)setArticleError(String(reason?.message||reason));}
    finally{if(request===sequence.current)setArticlesLoading(false);}
  };
  const openArticles=(site,categoryKey)=>{
    if(densityMode!=='source')return;
    // Clear the previous category before the new bounded page is fetched.
    // The request sequence invalidates late responses from the old category.
    resetArticles(site,categoryKey);
    setArticlesOpen(true);
    fetchArticles({site,offset:0});
  };
  useEffect(()=>{
    // Any date/filter change invalidates visible details, held text, active
    // worker results and expanded Source rows from the previous period.
    sequence.current+=1;fullSequence.current+=1;
    setArticlesOpen(false);setArticleRows([]);setArticleOffset(0);
    setArticleMore(false);setArticleError('');
    setSelectedSite('');setSelectedCategoryKey('');
    setFullUid('');setFullText('');setFullError('');
    setExpandedSources([]);
    setAnchorSuggestionsOpen(false);setFocusedSuggestionDate('');
  },[scopeId,rangeStart,rangeEnd,densityMode,keywordClass]);
  const loadMore=()=>{
    if(!articlesOpen||!selectedSite)return;
    if(articleMore&&!articlesLoading)fetchArticles({append:true,offset:articleOffset});
  };
  const toggleFull=async row=>{
    const request=++fullSequence.current;
    if(fullUid===row.uid){setFullUid('');setFullText('');return;}
    setFullUid(row.uid);setFullText('');setFullError('');
    try{
      const detail=await selectGalaxyIdentity(scope,row.uid);
      if(request!==fullSequence.current)return;
      if(!detail)throw new Error('本文已隱藏');
      setFullText(String(detail.content||''));
    }catch(reason){
      if(request===fullSequence.current)setFullError(String(reason?.message||reason));
    }
  };
  return <FeaturePage featureId='culture'>
    <section className='loc-card scope-feature-card scope-feature-card-wide'>
      <p className='loc-eyebrow'>文化｜時間密度</p>
      <h2>時間長河</h2>
      <p className='scope-status'>時間定錨預設最近一年（可回溯全部歷史）；文章密度預設：{start} ～ {end}</p>
      <section className='scope-card scope-culture-structure-river'>
        {loading?<p className='scope-status' role='status'>正在載入時間定錨…</p>:null}
        {error?<p className='scope-status scope-error' role='alert'>{error}</p>:null}
        <div className='scope-culture-structure-toolbar'><h3>時間定錨</h3>
          <span className='scope-status'>{recentTimeWindow.start} ～ {recentTimeWindow.end}（預設視野）</span></div>
        {!loading&&!error?<CultureTimeline items={anchorRiver.items} extraGroups={anchorRiver.groups}
          focus={NO_FOCUS} mode='trace'
          windowStart={recentTimeWindow.start} windowEnd={recentTimeWindow.end}
          onGroupToggle={group=>{
            const uid=String(group).replace(/^era:/,'');
            if(!String(group).startsWith('era:'))return;
            setExpandedEras(old=>old.includes(uid)?old.filter(x=>x!==uid):[...old,uid]);
          }}/>:null}
        {!loading&&!error&&!anchors.length?<p className='scope-status'>目前沒有時間定錨。</p>:null}
      </section>
      <section className='scope-card scope-culture-classification-river scope-public-culture-panel'>
        <div className='scope-culture-river-toolbar'><h3>文章密度</h3></div>
        <div className='scope-culture-river-selectors'>
          <label>時代／時期範圍
            <select className='scope-select' value={densityPeriod} onChange={event=>{setDensityPeriod(event.target.value);resetArticles('');}}>
              <option value='year'>{DEFAULT_YEAR_WINDOW.label}</option>
              {eraChoices.map(row=><option key={row.uid} value={row.uid}>{row.title}</option>)}
              <option value='custom'>自訂日期</option>
            </select>
          </label>
          {densityPeriod==='custom'?<>
            <label>起始日 <input type='date' className='scope-select' value={customStart} onChange={event=>setCustomStart(event.target.value)}/></label>
            <label>結束日 <input type='date' className='scope-select' value={customEnd} onChange={event=>setCustomEnd(event.target.value)}/></label>
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
        {catalogError&&densityMode==='source'?<p className='scope-status scope-error' role='alert'>
          來源分類暫時無法載入：{catalogError}</p>:null}
        {keywordError?<p className='scope-status scope-error' role='alert'>{keywordError}</p>:null}
        {densityLoading?<div className='scope-culture-density-loading' role='status'
          aria-live='polite' aria-label='正在整理該時期的每日文章密度'>
          <span className='scope-culture-density-loading__bar' aria-hidden='true'/>
          <span>正在整理時間河道的每日密度…</span>
        </div>:null}
        <div className='scope-culture-double-river scope-public-culture-river'>
        <CultureTimeline items={densityRiver.items} extraGroups={densityRiver.groups}
          focus={NO_FOCUS} mode='source' heightVariant='double' naturalSourceHeight
          windowStart={rangeStart} windowEnd={rangeEnd} fixedMin={rangeStart} fixedMax={rangeEnd}
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
            if(name==='root:anchor-suggestions'){
              setAnchorSuggestionsOpen(open=>!open);
              setFocusedSuggestionDate('');
              return;
            }
            if(name.startsWith('root:')){
              // Open/close child labels without requesting article rows.
              const id=name.slice(5);
              setExpandedSources(old=>old.includes(id)?old.filter(x=>x!==id):[...old,id]);
            }
          }}
          onGroupSelect={group=>{
            const name=String(group);
            if(!name.startsWith('site:')||densityMode!=='source')return;
            const category=densityRiver.sites.find(item=>'site:'+item.key===name);
            if(category)openArticles(category.site,category.key);
          }}/>
        </div>
        {anchorSuggestionsOpen?<div id='public-culture-anchor-analysis'
          className='scope-culture-anchor-actions' role='region'
          aria-label='建議定錨點分析'>
          {suggestionAnalysis.error?<p className='scope-status scope-error' role='alert'>
            {suggestionAnalysis.error}</p>:null}
          {suggestionAnalysis.suggestions.length?<div className='scope-culture-anchor-choices'>
            {suggestionAnalysis.suggestions.map(item=><div key={item.date}
              className='scope-status'>
              <button type='button' className='loc-button'
                aria-pressed={focusedSuggestionDate===item.date}
                onClick={()=>setFocusedSuggestionDate(item.date)}>
                {item.date} · 前三日 {item.beforeCount} 篇／後三日 {item.afterCount} 篇
              </button>
              <ScopeLink href={scopeHref(scopeId,'culture/manage')+
                '?edit=1&anchorDate='+encodeURIComponent(item.date)}>
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
        {densityMode==='source'&&expandedSources.length>0&&!articlesOpen?
          <p className='scope-status'>點選左側小分類，才會載入該分類文章。</p>:null}
      </section>
      {articlesOpen&&densityMode==='source'&&selectedSite?<section className='scope-card scope-culture-source-detail' data-selected-category={selectedCategoryKey}>
        <div className='scope-culture-source-detail-heading'>
          <h3>{selectedSite}｜相關文章列表</h3>
          <button type='button' className='loc-button' onClick={()=>resetArticles()}>
            關閉並釋放文章列表
          </button>
        </div>
        {articleError?<p role='alert' className='scope-status scope-error'>{articleError}</p>:null}
        {articleRows.map((row,index)=>row.hidden
          ?<p className='scope-status' key={row.key||index}>本文已隱藏</p>
          :<div className='scope-work-list-row' key={row.key||index}>
            <span>標題：{row.title}　日期：{row.date}　</span>
            <button type='button' className='loc-button'
              onClick={()=>toggleFull(row)}>全文展開</button>
            {fullUid===row.uid?<div>
              {fullError?<p className='scope-status scope-error'>{fullError}</p>:null}
              {fullText?<div>
                <p className='scope-status'>{fullText}</p>
                <ScopeLink className='loc-button' href={(()=>{
                  const base=scopeHref(scopeId,'search/manage');
                  return base+(base.includes('?')?'&':'?')+
                    'identity='+encodeURIComponent(row.uid);
                })()}>編輯</ScopeLink>
              </div>:null}
            </div>:null}
          </div>)}
        {articlesLoading?<p className='scope-status' role='status' aria-live='polite'>載入中請稍後</p>:null}
        {!articlesLoading&&articleMore
          ?<button type='button' className='loc-button' onClick={loadMore}>
            點擊繼續顯示
          </button>:null}
        {!articlesLoading&&!articleRows.length&&!articleError
          ?<p className='scope-status'>沒有相關文章。</p>:null}
      </section>:null}
    </section>
  </FeaturePage>;
}
