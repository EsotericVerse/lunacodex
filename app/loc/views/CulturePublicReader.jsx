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
import {indexZModelAnchorHierarchy} from '../../../zenstack/anchor-hierarchy.mjs';

const CultureTimeline=dynamic(()=>import('../../modular/modules/culture-timeline/CultureTimeline'),{loading:()=>null});
const NO_ITEMS=Object.freeze([]);
const NO_FOCUS=Object.freeze({});
const datePart=value=>String(value||'').slice(0,10);
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
  const all=list(rows);
  const byUid=new Map(all.map(row=>[String(row.uid),row]));
  // The same Scope may contain canonical Base62 and historical short UIDs.
  // Project only canonical, valid Time edges with ZModel. One legacy row must
  // never invalidate every canonical Era/Period in the first Culture river.
  const canonical=all.filter(row=>{
    if(!/^[A-Za-z0-9]{8}$/.test(String(row.uid||'')))return false;
    const attr=attributes(row);
    const link=row.type==='era'?attr.period:
      row.type==='period'?attr.uid:null;
    return !Array.isArray(link)||link.every(uid=>/^[A-Za-z0-9]{8}$/.test(String(uid)));
  });
  let timeGraph=null;
  if(canonical.length){
    try{timeGraph=indexZModelAnchorHierarchy(canonical,{family:'time'});}
    catch(error){console.warn('[LOC Culture] Time projection:',String(error?.message||error));}
  }
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
    const savedPeriodUids=list(attr.period||attr.periods);
    const resolved=timeGraph&&Array.isArray(attr.period)?timeGraph.childrenOf(uid):[];
    // Partially published graphs may contain unresolved links. Resolve only
    // complete canonical branches; old IDs still use the explicit saved UIDs.
    const periodUids=resolved.length===savedPeriodUids.length?
      resolved:savedPeriodUids;
    const refs=periodUids.map(id=>byUid.get(String(id)))
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
    if(!expandedEra)continue;
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
  const sourceRows=list(rows);
  const names=[...new Set(sourceRows.map(row=>String(row.site||'')))];
  const categories=taxonomy?.categories||[],aliases=taxonomy?.aliases||[];
  const byUid=new Map((taxonomy?.tree||[]).map(row=>[row.uid,row]));
  const siteCode=site=>assignedSource(site,aliases,categories);
  const roots=taxonomy?(taxonomy.roots||[]).map(node=>{
    const descendants=new Set((taxonomy.tree||[])
      .filter(row=>row.path?.[0]===node.uid).map(row=>row.uid));
    const sites=names.filter(site=>descendants.has(siteCode(site)));
    const labels=new Map(sites.map(site=>{
      const entry=byUid.get(siteCode(site));
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
  const max=Math.max(1,...sourceRows.map(row=>Number(row.item_count)||0));
  for(const root of roots){
    const total=sourceRows.filter(row=>root.sites.includes(String(row.site)))
      .reduce((sum,row)=>sum+Number(row.item_count||0),0);
    const opened=expanded.includes(root.id);
    groups.push({id:'root:'+root.id,label:root.label+' ('+total+')',
      collapsible:true,expanded:opened,order:groups.length});
    if(!opened){
      const daily=new Map();
      for(const row of sourceRows){
        if(!root.sites.includes(String(row.site)))continue;
        daily.set(row.day,(daily.get(row.day)||0)+Number(row.item_count||0));
      }
      for(const [day,count] of daily){
        if(day<start||day>end)continue;
        items.push({id:'root:'+root.id+':'+day,entry_type:'source_total',
          group_key:'root:'+root.id,group_label:root.label,start_date:day,
          item_count:count,density_ratio:count/max,display_label:'',title:day+' · '+count});
      }
      continue;
    }
    for(const site of root.sites){
      const label=root.labels.get(site)||site;
      const key=root.id+':'+site;
      const count=sourceRows.filter(row=>String(row.site)===site)
        .reduce((sum,row)=>sum+Number(row.item_count||0),0);
      groups.push({id:'site:'+key,label:'　'+label+' ('+count+')',
        selectable:true,order:groups.length});
      sites.push({key,site,root:root.id,count,label});
      for(const row of sourceRows){
        if(String(row.site)!==site||row.day<start||row.day>end)continue;
        items.push({id:'site:'+key+':'+row.day,entry_type:'source',
          group_key:'site:'+key,group_label:label,start_date:row.day,
          item_count:Number(row.item_count||0),
          density_ratio:Number(row.item_count||0)/max,
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
  const [catalog,setCatalog]=useState({categories:[],aliases:[],tree:[],roots:[]});
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const [expandedEras,setExpandedEras]=useState([]);
  const [expandedSources,setExpandedSources]=useState([]);
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
    setLoading(true);setError('');setAnchors([]);
    Promise.all([analytics(scopeId,'culture_anchors',null,null),
      readPublicSourceTaxonomy()]).then(([time,types])=>{
      if(cancelled)return;
      setAnchors(time);setCatalog(types);setLoading(false);
    }).catch(reason=>{if(!cancelled){setError(String(reason?.message||reason));setLoading(false);}});
    return()=>{cancelled=true};
  },[scopeId]);
  useEffect(()=>{
    let active=true;
    setDaily([]);setKeywordError('');
    if(!validRange)return undefined;
    // Bounded daily density is the single data source for both presentations.
    // Keyword lanes are equal-proportion projections of the same daily totals,
    // not the retired article UID-list keyword_summary algorithm.
    analytics(scopeId,'culture_density',rangeStart,rangeEnd)
      .then(rows=>{if(active)setDaily(rows);})
      .catch(error=>{if(active)setKeywordError(String(error?.message||error));});
    return()=>{active=false;};
  },[scopeId,rangeStart,rangeEnd,validRange]);
  useEffect(()=>{
    if(densityMode!=='keyword'||!keywordClass){setKeywordGroups([]);return undefined;}
    let active=true;
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
    if(densityMode!=='keyword')return undefined;
    let active=true;
    setClassesLoading(true);
    import('../keyword-service-client.mjs')
      .then(({keywordService})=>keywordService('classes',{scopeId}))
      .then(result=>{if(active)setKeywordClasses(result?.classes||[]);})
      .catch(error=>{if(active)setKeywordError(String(error?.message||error));})
      .finally(()=>{if(active)setClassesLoading(false);});
    return()=>{active=false;};
  },[scopeId,densityMode]);
  const anchorRiver=useMemo(()=>anchorModel(anchors,start,end,expandedEras),
    [anchors,start,end,expandedEras]);
  const densityRiver=useMemo(()=>densityMode==='keyword'
    ?sourceModel(keywordDaily,null,expandedSources,rangeStart,rangeEnd)
    :sourceModel(daily,catalog,expandedSources,rangeStart,rangeEnd),
    [densityMode,keywordDaily,daily,catalog,expandedSources,rangeStart,rangeEnd]);
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
    // Any date/filter change invalidates the currently visible list.
    sequence.current+=1;fullSequence.current+=1;
    setArticlesOpen(false);setArticleRows([]);setArticleOffset(0);
    setArticleMore(false);setArticleError('');
    setSelectedSite('');setSelectedCategoryKey('');
    setFullUid('');setFullText('');setFullError('');
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
      <p className='scope-status'>{start} ～ {end}</p>
      {loading?<p className='scope-status' role='status'>載入時間定錨與每日文章密度…</p>:null}
      {error?<p className='scope-status scope-error' role='alert'>{error}</p>:null}
      {!loading&&!error?<><section className='scope-card scope-culture-structure-river'>
        <div className='scope-culture-structure-toolbar'><h3>時間定錨</h3></div>
        <CultureTimeline items={anchorRiver.items} extraGroups={anchorRiver.groups}
          focus={NO_FOCUS} mode='trace' windowStart={start} windowEnd={end}
          fixedMin={start} fixedMax={end}
          onGroupToggle={group=>{
            const uid=String(group).replace(/^era:/,'');
            if(!String(group).startsWith('era:'))return;
            setExpandedEras(old=>old.includes(uid)?old.filter(x=>x!==uid):[...old,uid]);
          }}/>
        {!anchors.length?<p className='scope-status'>此區間沒有時間定錨。</p>:null}
      </section>
      <section className='scope-card scope-culture-classification-river'>
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
        {keywordError?<p className='scope-status scope-error' role='alert'>{keywordError}</p>:null}
        <CultureTimeline items={densityRiver.items} extraGroups={densityRiver.groups}
          focus={NO_FOCUS} mode='source' heightVariant='double'
          windowStart={rangeStart} windowEnd={rangeEnd} fixedMin={rangeStart} fixedMax={rangeEnd}
          onGroupToggle={group=>{
            const name=String(group);
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
        {densityMode==='keyword'&&keywordClass?<p className='scope-status'>每日關鍵詞密度來自詞級索引的實際 UID 命中，依日期統計並去重文章。</p>:null}
        {densityMode==='keyword'&&classesLoading?<p className='scope-status'>正在載入關鍵詞科目…</p>:null}
        {densityMode==='keyword'&&keywordLoading?<p className='scope-status'>正在載入關鍵詞統計…</p>:null}
        {densityMode==='keyword'&&!classesLoading&&!keywordClasses.length?<p className='scope-status'>目前沒有可使用的公開關鍵詞科目。</p>:null}
        {densityMode==='keyword'&&keywordClass&&!keywordLoading&&!keywordError&&!keywordGroups.length?<p className='scope-status'>此範圍沒有可顯示的關鍵詞統計。</p>:null}
        {densityMode==='source'&&expandedSources.length>0&&!articlesOpen?
          <p className='scope-status'>點選左側小分類，才會載入該分類文章。</p>:null}
      </section>
      {articlesOpen&&densityMode==='source'&&selectedSite?<section className='scope-card scope-culture-source-detail' data-selected-category={selectedCategoryKey}>
        <h3>{selectedSite}｜相關文章列表</h3>
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
      </>:null}
    </section>
  </FeaturePage>;
}
