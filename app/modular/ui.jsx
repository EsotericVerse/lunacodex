'use client';
import UiText,{useUiText} from '../i18n/UiText';

import {useEffect,useMemo,useRef,useState} from 'react';
import {scopeFeatureEnabled} from '../loc/scope-config-fields.mjs';
import {isUnifiedAnchorScope} from '../loc/unified-anchor-compat.mjs';
import dynamic from 'next/dynamic';
import {usePathname} from 'next/navigation';
import {useEditDock} from './edit-dock';
import {useAsyncResource} from '../loc/use-async-resource';
import {UI_COPY} from '../i18n/ui-copy';
import {useUiCopy,useUiLocale} from '../i18n/ui-locale';
import {DEFAULT_LIST_BATCH_SIZE,LIST_LOAD_COOLDOWN_MS} from '../loc/db-contract.mjs';
import {useScopeRuntime} from './use-scope-runtime';
import {selectScopeBlocks,selectLiveScopeBlocks,heroBlocks} from '../loc/scope-data';
import {heroImageUrl as heroImageUrlOf} from '../loc/hero-image.mjs';

import {HomeBlock} from '../loc/home-block-model';
import ScopeLink from './ScopeLink';
import {featureNavigationHref} from './feature-navigation';
import {scopeHref} from './scope-registry';
// Shared display stays light: mount the editor only on pages that need it.
const BlockNoteEditor=dynamic(()=>import('../loc/BlockNoteEditor'),{loading:()=>null});
const ArticleTimeAnchorAction=dynamic(()=>import('./ArticleTimeAnchorAction'),{loading:()=>null});

function FeatureHeroContent({eyebrow='',title,subtitle='',description='',rich=false,scopeId=''}){
  const sign=HomeBlock.heroExtraFor(scopeId);
  return <>
    {eyebrow?<p className="loc-eyebrow">{eyebrow}</p>:null}
    <div className="home-title-row">
      <h1>{title}</h1>
      {subtitle?<p className="loc-subtitle scope-subtitle">{HomeBlock.plainBlockLine(subtitle)}</p>:null}
    </div>
    {description?(rich
      ?<div className="scope-hero-description scope-shared-hero-rich" dangerouslySetInnerHTML={{__html:description}}/>
      :<div className="scope-hero-description">{description}</div>):null}
    {sign?<span className={'home-hero-identity home-hero-identity--'+sign.key}
      role="img" aria-label={sign.label}>{sign.text}</span>:null}
  </>;
}

export function FeaturePage({featureId,children,titleOverride=null,subtitle=null,description=null}){
  const {scope,scopeId}=useScopeRuntime();
  const copy=useUiCopy();
  const {locale}=useUiLocale();
  const profile=copy.features?.[featureId]||UI_COPY.features?.[featureId]||{title:featureId,subtitle:'',description:''};
  const scopeCopyKey=scope?.id==='lo3rwang'?'author':scope?.id;
  const localizedScope=copy.scope?.[scopeCopyKey]||null;
  const resolvedSubtitle=localizedScope?.[featureId]||scope?.featureSubtitles?.[featureId]||profile.subtitle||'';
  const resolvedDescription=description??profile.description;
  const finalSubtitle=subtitle||resolvedSubtitle;
  const pathname=usePathname();
  const editDock=useEditDock();
  const editing=Boolean(editDock?.active&&editDock.scopeId===scopeId);
  const managementSlot=HomeBlock.managementHeroSlot(pathname,scopeId,editing,featureId);
  const managementMode=Boolean(managementSlot);
  const sharedEnabled=HomeBlock.shouldUseSharedFeatureHero(scopeId,featureId);
  const artworkId=managementMode?'manage':featureId;
  const heroClassName='loc-card scope-hero scope-feature-hero'+(HomeBlock.FEATURE_HERO_ORDER[artworkId]?' scope-feature-hero--artwork scope-feature-hero--'+artworkId:'');
  const hasFeatureHero=Boolean(HomeBlock.FEATURE_HERO_ORDER[featureId]);
  // Management entries share a single editable image and independently saved
  // text. The Admin and Personal Settings landing Heroes stay separate.
  // Admin / Settings / protected management entry Heroes use live, persisted
  // records. The four public browsing Heroes keep their published JS snapshots
  // until the owner deliberately republishes; no ISR/deployment is triggered.
  const adminHero=featureId==='admin'||featureId==='setting';
  const groupHeroPage=HomeBlock.featureHeroPageFor(featureId);
  const scopeHeroPage='scope_'+featureId;
  // One direct Hero SELECT for the public feature (both group and scope
  // artwork slots). Public page rendering never looks up Manage permissions.
  const publicHeroQuery=useAsyncResource(['feature-hero-blocks',scopeId,featureId],
    ()=>heroBlocks(scopeId,featureId),{
      enabled:!managementMode&&!adminHero&&(sharedEnabled||hasFeatureHero)
    });
  const adminHeroQuery=useAsyncResource(['scope-blocks-live','loc',groupHeroPage],
    ()=>selectLiveScopeBlocks('loc',groupHeroPage),{
      enabled:!managementMode&&adminHero
    });
  const groupHeroRows=adminHero
    ?adminHeroQuery.data||[]
    :(publicHeroQuery.data||[]).filter(row=>row.page_name===groupHeroPage);
  const scopeHeroRows=adminHero
    ?[]:(publicHeroQuery.data||[]).filter(row=>row.page_name===scopeHeroPage);
  const managementTextPage=managementSlot?.page||'';
  const managementImagePage=HomeBlock.managementHeroImagePage(managementSlot);
  const managementTextQuery=useAsyncResource(['scope-blocks-live','loc',managementTextPage],
    ()=>selectLiveScopeBlocks('loc',managementTextPage),{enabled:managementMode});
  const managementImageQuery=useAsyncResource(['scope-blocks-live','loc',managementImagePage],
    ()=>selectLiveScopeBlocks('loc',managementImagePage),{enabled:managementMode});
  const heroImageRow=managementMode
    ?managementImageQuery.data?.find(row=>Number(row.block_order)===1)
    :((scopeId==='loc'&&!HomeBlock.shouldUseSingleFeatureHeroImage(featureId))
      ?groupHeroRows:scopeHeroRows).find(row=>Number(row.block_order)===1);
  const heroImageOverride=heroImageUrlOf(heroImageRow)||(managementMode?HomeBlock.managementHeroDefaultImage(managementSlot):'');
  const heroStyle=heroImageOverride?{'--scope-feature-hero-image':`url("${heroImageOverride}")`}:undefined;
  const shared=managementMode?HomeBlock.managementHeroCopy(managementTextQuery.data,managementSlot)
    :sharedEnabled?HomeBlock.featureHeroFor(groupHeroRows):null;
  const fallbackCopy={
    title:profile.title,
    subtitle:finalSubtitle,
    description:resolvedDescription
  };

  const publicFeature=!managementMode&&['culture','statics','search','trace'].includes(featureId)?featureId:'';
  return <main className={'scope-main'+(managementMode?' scope-main--edit-workspace':'')} data-public-feature={publicFeature||undefined}>
    <section className="scope-page">
      <header className={heroClassName} style={heroStyle} data-feature-hero-source={managementMode?managementTextPage:shared?'loc':'default'}>
        <FeatureHeroContent
          scopeId={scopeId}
          eyebrow={shared?.eyebrow||''}
          title={managementMode?shared?.title||managementSlot.label:titleOverride||shared?.title||fallbackCopy.title}
          subtitle={managementMode?shared?.subtitle||'':shared?shared.subtitle:fallbackCopy.subtitle}
          description={managementMode?shared?.description||'':shared?shared.description:fallbackCopy.description}
          rich={Boolean(shared)&&!managementMode}
        />
      </header>
      <div className={"scope-content"+(publicFeature?" loc-public-content":"")}>
        {children}
      </div>
    </section>
  </main>;
}

export function WorkFullText({
  open=false,
  loading=false,
  error='',
  content='',
  onToggle,
  emptyText=null,
  showToggle=true
}){
  const copy=useUiCopy();
  return <div className="scope-work-fulltext">
    {showToggle?<button type="button" onClick={onToggle} disabled={loading}>
      {open?(loading?copy.work.loadingBody:copy.work.collapseBody):copy.work.viewBody}
    </button>:null}
    {open&&error?<p className="scope-status scope-error">{error}</p>:null}
    {open&&!loading&&!error?<div className="scope-inline-card scope-article-block-display">
      <BlockNoteEditor editable={false} initialContent={content||(emptyText??copy.work.noBody)}/>
    </div>:null}
  </div>;
}

function externalLink(link){
  const href=String(link?.href||'').trim();
  return /^https?:\/\//i.test(href)?href:'';
}
function safeExternalLinksOf(items=[],defaultLabel=''){
  return (Array.isArray(items)?items:[])
    .map((link,index)=>typeof link==='string'?{id:String(index),href:link,label:defaultLabel}:link)
    .filter(link=>externalLink(link));
}
function safeRelationLinksOf(items=[],defaultLabel=''){
  return (Array.isArray(items)?items:[])
    .map((link,index)=>typeof link==='string'?{id:String(index),href:link,label:defaultLabel}:link)
    .filter(link=>{
      const href=String(link?.href||'').trim();
      return Boolean(href)&&!/^javascript:/i.test(href);
    });
}

const ArticleContextStatisticsChart=dynamic(()=>import('./modules/statistics/StatisticsMultiChart'),{
  ssr:false,loading:()=> <p className="scope-status">正在準備統計圖…</p>
});
function ArticleStatisticsPreview({scopeId='',statistics=null}){
  const [open,setOpen]=useState(false);
  const [range,setRange]=useState('week');
  const selection=statistics?.[range];
  const query=useAsyncResource({
    queryKey:['article-date-stat-chart',scopeId,range,selection?.start,selection?.end],
    enabled:open&&Boolean(scopeId&&selection?.start&&selection?.end),
    queryFn:async()=>{
      const {readScopeStatistics}=await import('../loc/db-client.mjs');
      return readScopeStatistics(scopeId,{startDate:selection.start,endDate:selection.end});
    },
    revalidateOnFocus:false,revalidateOnReconnect:false
  });
  if(!statistics?.week||!statistics?.year)return null;
  const sourceRows=(query.data||[]).filter(item=>item.kind==='total'&&item.category==='文字作品');
  const totals=new Map();
  for(const item of sourceRows){
    const day=String(item.day||'').slice(0,10);
    if(day)totals.set(day,(totals.get(day)||0)+(Number(item.item_count)||0));
  }
  const rows=[...totals].sort(([a],[b])=>a.localeCompare(b))
    .map(([day,count])=>({period:day.slice(5).replace('-','/'),start_date:day,value:count}));
  return <details className="scope-article-context-stat-preview" onToggle={event=>setOpen(event.currentTarget.open)}>
    <summary>展開相關統計圖</summary>
    {open?<div className="scope-article-context-stat-body">
      <label>統計範圍
        <select value={range} className="scope-select" onChange={event=>setRange(event.target.value)}>
          <option value="week">當週</option><option value="year">當年</option>
        </select>
      </label>
      {query.isPending?<p className="scope-status" role="status">正在載入時間統計…</p>:null}
      {query.error?<p className="scope-status scope-error" role="alert">{String(query.error?.message||query.error)}</p>:null}
      {query.isSuccess?(rows.length?<ArticleContextStatisticsChart
        type="line" rows={rows} series={[{key:'value',label:'文章篇數'}]}
        height={230}/>:<p className="scope-status">這段時間沒有符合條件的文字統計。</p>):null}
    </div>:null}
  </details>;
}

function ArticleRelationNavigation({
  links=[],externalLinks=[],relatedMedia=[],relatedTime=null,
  relatedSpace=null,relatedStatistics=null,tracePlace=null,traceHref='',
  locationName='',articleScopeId='',articleDate='',articleCreateTime=''
}){
  const refs=links.filter(link=>String(link.id||'').startsWith('reference:'));
  const above=links.filter(link=>String(link.id||'').startsWith('source:'));
  const below=links.filter(link=>String(link.id||'').startsWith('target:'));
  const originals=externalLinks.filter(link=>!String(link.id||'').startsWith('media:'));
  const {scopeId:currentScopeId}=useScopeRuntime();
  const scope=articleScopeId||currentScopeId;
  const day=String(articleDate||'').slice(0,10);
  const [addedAnchor,setAddedAnchor]=useState(null);
  const timeHref=(item,kind)=>featureNavigationHref(scope,'culture',{
    from:day,to:day,...(kind==='anchor'?{anchor:item.uid}:{period:item.uid})
  });
  const traceLink=(item,kind)=>featureNavigationHref(scope,'trace',
    kind==='place'?{place:item.uid}:{map:item.uid});
  const articles=items=>items.map((item,index)=><a key={item.id||item.href||index}
    className="scope-article-context-link" href={item.href}>{item.title||item.label||'閱讀文章'}</a>);
  const named=(items,href)=>Array.isArray(items)?items.map((item,index)=><a
    key={item.uid||index} href={href(item)} className="scope-article-context-link">
    {item.title||item.uid}</a>):[];
  const row=(label,children)=><div className="scope-article-context-row" key={label}>
    <strong>{label}：</strong><div className="scope-article-context-items">{children}</div>
  </div>;
  const mediaItems=relatedMedia.map((item,index)=>{
    const isRunes=String(item.type||'').toLowerCase()==='rune';
    const label=String(item.title||'').trim()||(isRunes?'抽牌結果':'媒體 '+(index+1));
    const href=externalLink({href:item.url});
    const description=String(item.description||'').trim();
    let cards=[],spread='',spreadLayout='';
    if(isRunes&&description.startsWith('{')){
      try{
        const parsed=JSON.parse(description);
        if(Array.isArray(parsed?.cards)){
          cards=parsed.cards.filter(card=>card&&card.rune);
          const describe=value=>typeof value==='string'?value
            :value==null?'':JSON.stringify(value);
          spread=describe(parsed.spread);
          spreadLayout=describe(parsed.spread_layout);
        }
      }catch{/* Plain-text rune descriptions remain valid. */}
    }
    return <div key={item.uid||index} className="scope-article-context-media">
      {href?<a href={href} target="_blank" rel="noopener noreferrer"
        className="scope-article-context-link">{label}</a>:<strong>{label}</strong>}
      {isRunes?<a className="scope-article-context-link" href={scopeHref('lrunes')}>符文</a>:null}
      {description?<details className="scope-article-context-description">
        <summary>{isRunes?'抽牌內容':'媒體描述'}</summary>
        {cards.length?<>
          {spread?<p>牌陣：{spread}</p>:null}
          {spreadLayout?<p>排列：{spreadLayout}</p>:null}
          <ol className="scope-article-rune-list">
            {cards.map((card,position)=><li key={position}>
              <strong>{String(card.rune||'')}</strong>
              <span>{String(card.direction||'')}</span>
              <small>{String(card.position||position+1)}</small>
            </li>)}
          </ol>
          <details className="scope-article-context-raw-runes">
            <summary>完整抽牌資料</summary>
            <pre>{description}</pre>
          </details>
        </>:<p>{description}</p>}
      </details>:null}
    </div>;
  });
  const ordinaryMedia=mediaItems.filter((_,index)=>
    String(relatedMedia[index]?.type||'').toLowerCase()!=='rune'&&externalLink({href:relatedMedia[index]?.url}));
  const mediaDetails=mediaItems.filter((_,index)=>
    String(relatedMedia[index]?.type||'').toLowerCase()!=='rune'&&!externalLink({href:relatedMedia[index]?.url}));
  const runeMedia=mediaItems.filter((_,index)=>String(relatedMedia[index]?.type||'').toLowerCase()==='rune');
  const time=relatedTime||{},space=relatedSpace||{};
  const dateValid=/^\d{4}-\d{2}-\d{2}$/.test(day);
  const statistics=relatedStatistics;
  const statsItems=statistics?[
    {name:'當週統計',data:statistics.week},
    {name:'當年統計',data:statistics.year}
  ].filter(item=>item.data).map(item=><a key={item.name}
      href={featureNavigationHref(scope,'statics',{from:item.data.start,to:item.data.end,statTab:'charts'})}
      className="scope-article-context-link">{item.name}</a>):[];
  const activeAnchors=Array.isArray(time.anchors)?[...time.anchors]:[];
  if(addedAnchor?.scope===scope&&addedAnchor?.day===day&&
    !activeAnchors.some(item=>item.uid===addedAnchor.anchor.uid))activeAnchors.push(addedAnchor.anchor);
  const timeAnchors=named(activeAnchors,item=>timeHref(item,'anchor'));
  const anniversarySuggestions=activeAnchors.length?[]:
    (Array.isArray(time.anniversarySuggestions)?time.anniversarySuggestions:[]);
  const periods=named(time.periods,item=>timeHref(item,'period'));
  const eras=named(time.eras,item=>timeHref(item,'period'));
  const locations=space.place?[space.place]:tracePlace?[tracePlace]:[];
  const places=named(locations,item=>traceLink(item,'place'));
  const routes=named(space.routes,item=>traceLink(item,'map'));
  const traces=named(space.traces,item=>traceLink(item,'map'));
  return <section className="scope-article-context" aria-label="文章整合脈絡">
    {ordinaryMedia.length?row('相關媒體外部連結',ordinaryMedia):null}
    {mediaDetails.length?row('相關媒體資料',mediaDetails):null}
    {runeMedia.length?row('抽牌結果（多媒體）',runeMedia):null}
    {refs.length?row('參考',articles(refs)):null}
    {above.length?row('上',articles(above)):null}
    {below.length?<div className="scope-article-context-row">
      <strong>下：</strong><details className="scope-article-context-down">
        <summary>展開 {below.length} 筆下筆文章</summary>
        <div className="scope-article-context-items">{articles(below)}</div>
      </details>
    </div>:null}
    <div className="scope-article-context-group">
      <h3>時間</h3>
      {row('定錨',<>
        {timeAnchors.length?timeAnchors:dateValid?'—':'文章尚未設定日期'}
        {anniversarySuggestions.length?<span className="scope-status" role="status">
          此日期符合週年／生日：{anniversarySuggestions[0].title}，可新增週年定錨。
        </span>:null}
        {dateValid&&scope!=='loc'&&scope!=='local'?<ArticleTimeAnchorAction
          scopeId={scope} date={day} articleCreateTime={articleCreateTime} suggestions={anniversarySuggestions}
          label={anniversarySuggestions.length?'新增週年定錨':'新增時間定錨'}
          onCreated={anchor=>setAddedAnchor({scope,day,anchor})}/>:null}
      </>)}
      {row('期間',periods.length?periods:'—')}
      {row('時代',eras.length?eras:'—')}

    </div>
    <div className="scope-article-context-group">
      <h3>空間</h3>
      {row('地點',places.length?places:locationName||'尚未定錨')}
      {row('路線',routes.length?routes:'—')}
      {row('痕跡圖',traces.length?traces:'—')}
    </div>
    <div className="scope-article-context-group">
      <h3>統計</h3>
      {row('時間統計',dateValid
        ?statsItems.length?statsItems:<a className="scope-article-context-link"
          href={featureNavigationHref(scope,'statics',{from:day,to:day})}>查看時間統計</a>
        :'需要文章日期')}
      {row('關鍵詞統計',dateValid?<a className="scope-article-context-link"
        href={featureNavigationHref(scope,'statics',{statTab:'keywords',from:day,to:day})}>查看關鍵詞統計</a>
        :'需要文章日期')}
      <ArticleStatisticsPreview scopeId={scope} statistics={statistics}/>
    </div>
    {row('關鍵詞組別',<span className="scope-status">待建立關鍵詞對應</span>)}
    {originals.length?row('文章原始網址',originals.map((item,index)=><a
      key={item.id||index} className="scope-article-context-link" href={externalLink(item)}
      target="_blank" rel="noopener noreferrer">{externalLink(item)}</a>)):null}
  </section>;
}

export function WorkSummaryCard({
  title=null,
  titleEditor=null,
  titleHref='',
  kicker=null,
  source='',
  scopeId='',
  date='',
  checkIn='',
  body='',
  hidden=false,
  relationLinks=[],
  detailReading=false,
  relatedMedia=[],
  relatedTime=null,
  relatedSpace=null,
  relatedStatistics=null,
  articleScopeId='',
  articleDate='',
  articleCreateTime='',
  tracePlace=null,
  traceHref='',
  locationName='',
  links=[],
  destinations=[],
  showSource=true,
  showLinks=true,
  children=null,
  className='',
  actions=null,
  onClick=null,
  onClickCapture=null
}){
  const copy=useUiCopy();
  const safeRelations=safeRelationLinksOf(relationLinks,copy.work.relatedText);
  const safeLinks=safeExternalLinksOf(links,copy.work.viewLinks);
  return <article className={'scope-inline-card scope-work-summary '+className+(onClickCapture?' is-inline-editable':'')} onClick={onClick||undefined} onClickCapture={onClickCapture}>
    <header className="scope-culture-work-heading">
      <div>
        {kicker?<p className="loc-eyebrow scope-card-kicker">{kicker}</p>:null}
        {(scopeId||showSource&&source)?<p className="loc-eyebrow">{[scopeId,showSource?source:''].filter(Boolean).join(' · ')}</p>:null}
        {titleEditor||(titleHref
          ?<a href={titleHref} className="scope-article-title-link"><strong>{title??copy.work.untitled}</strong></a>
          :<strong>{title??copy.work.untitled}</strong>)}
        {checkIn?<p className="scope-work-checkin">{checkIn}</p>:null}
      </div>
      {date||actions?<div className="scope-work-summary-actions">{date?<time>{date}</time>:null}{actions}</div>:null}
    </header>
    {hidden?<p className="scope-status">{copy.work.hidden}</p>:null}
    {body?<p className="scope-culture-work-meta-description">{body}</p>:null}
    {!detailReading&&safeRelations.length?<div className="scope-result-links scope-work-relations">
      {safeRelations.map((link,index)=><ScopeLink key={link.id||link.href||index} href={String(link.href||'').trim()}>{link.label||copy.format.relatedText(index+1)}</ScopeLink>)}
    </div>:null}
    {!detailReading&&showLinks&&safeLinks.length?<div className="scope-result-links">
      {safeLinks.map((link,index)=><a key={link.id||link.href||index} href={externalLink(link)} target="_blank" rel="noreferrer">{link.label||copy.format.link(index+1)}</a>)}
    </div>:null}
    {destinations?.length?<div className="scope-result-links">
      {destinations.map(destination=><ScopeLink key={destination.id||destination.href} href={destination.href}>{destination.label}</ScopeLink>)}
    </div>:null}
    {children}
    {detailReading?<ArticleRelationNavigation links={safeRelations} externalLinks={showLinks?safeLinks:[]}
      relatedMedia={relatedMedia} relatedTime={relatedTime} relatedSpace={relatedSpace}
      relatedStatistics={relatedStatistics} articleScopeId={articleScopeId} articleDate={articleDate}
      articleCreateTime={articleCreateTime}
      tracePlace={tracePlace} traceHref={traceHref} locationName={locationName}/>:null}
  </article>;
}

function IncrementalLoad({
  hasMore=false,
  loading=false,
  error=null,
  onLoadMore,
  cooldownMs=LIST_LOAD_COOLDOWN_MS,
  label='…',
  scrollRootRef=null
}){
  const t=useUiText();
  const sentinelRef=useRef(null);
  const loadingRef=useRef(Boolean(loading));
  const readyAtRef=useRef(0);

  useEffect(()=>{loadingRef.current=Boolean(loading);},[loading]);
  useEffect(()=>{
    const sentinel=sentinelRef.current;
    if(!hasMore||!sentinel||typeof onLoadMore!=='function')return undefined;
    const observer=new IntersectionObserver(entries=>{
      if(!entries.some(entry=>entry.isIntersecting))return;
      const now=Date.now();
      if(loadingRef.current||error||now<readyAtRef.current)return;
      readyAtRef.current=now+Math.max(0,Number(cooldownMs)||0);
      onLoadMore();
    },{root:scrollRootRef?.current||null,threshold:0.1,rootMargin:'80px 0px'});
    observer.observe(sentinel);
    return()=>observer.disconnect();
  },[hasMore,error,onLoadMore,cooldownMs,scrollRootRef]);

  if(!hasMore)return null;
  return <div ref={sentinelRef} className={'scope-load-sentinel'+(loading?' is-loading':'')} aria-live="polite">
    <button type="button" className="loc-button" disabled={loading} onClick={()=>onLoadMore?.()} aria-label={t('uiExtra.pagination.loadMoreAria')}><UiText id={loading?'uiExtra.pagination.loading':'uiExtra.pagination.loadMore'}/></button>
  </div>;
}

export function ArticleSortSelect({value='desc',onChange,disabled=false}){
  return <label className="scope-article-sort-control" style={{display:'inline-flex',alignItems:'center',gap:'.4rem',fontSize:'.875rem'}}>
    排序
    <select aria-label="文章列表排序" value={value} disabled={disabled}
      onChange={event=>onChange(event.target.value)}
      style={{maxWidth:'100%',padding:'.25rem .45rem',fontSize:'inherit',borderRadius:'.4rem'}}>
      <option value="desc">最新優先</option>
      <option value="asc">最舊優先</option>
    </select>
  </label>;
}

export function IncrementalList({
  items=[],
  renderItem,
  batchSize=DEFAULT_LIST_BATCH_SIZE,
  resetKey='',
  className='scope-list',
  empty=null,
  externalHasMore=false,
  loading=false,
  error=null,
  onLoadMore=null,
  scrollRootRef=null,
  onVisibleItemsChange=null
}){
  const size=Math.max(1,Math.floor(Number(batchSize)||DEFAULT_LIST_BATCH_SIZE));
  const source=Array.isArray(items)?items:[];
  const [visibleCount,setVisibleCount]=useState(()=>Math.min(size,source.length));
  const pendingExternalRef=useRef(false);

  useEffect(()=>{
    pendingExternalRef.current=false;
    setVisibleCount(Math.min(size,source.length));
  },[resetKey,size]);

  useEffect(()=>{
    if(source.length>0&&visibleCount===0&&!pendingExternalRef.current){
      setVisibleCount(Math.min(size,source.length));
      return;
    }
    if(visibleCount>source.length){
      setVisibleCount(Math.min(size,source.length));
      pendingExternalRef.current=false;
      return;
    }
    if(pendingExternalRef.current&&source.length>visibleCount){
      setVisibleCount(count=>Math.min(source.length,count+size));
      pendingExternalRef.current=false;
    }
  },[source.length,size,visibleCount]);

  const hasBuffered=visibleCount<source.length;
  const hasMore=hasBuffered||Boolean(externalHasMore);
  const visible=useMemo(()=>source.slice(0,visibleCount),[source,visibleCount]);

  useEffect(()=>{
    if(typeof onVisibleItemsChange==='function')onVisibleItemsChange(visible);
  },[visible,onVisibleItemsChange]);

  const loadMore=()=>{
    if(loading)return;
    if(hasBuffered){
      setVisibleCount(count=>Math.min(source.length,count+size));
      return;
    }
    if(externalHasMore&&typeof onLoadMore==='function'){
      pendingExternalRef.current=true;
      onLoadMore();
    }
  };

  if(!source.length&&!loading&&!externalHasMore)return empty;
  const loader=<IncrementalLoad
    hasMore={hasMore}
    loading={loading}
    error={error}
    onLoadMore={loadMore}
    label="…"
    scrollRootRef={scrollRootRef}
  />;
  return <>
    <div ref={scrollRootRef||undefined} className={className}>
      {visible.map((item,index)=>renderItem(item,index))}
      {scrollRootRef?loader:null}
    </div>
    {!scrollRootRef?loader:null}
  </>;
}

/** One feature-availability control shared by Scope settings and Admin drafts. */
export function ScopeFeatureToggles({value={},onChange,className='scope-editor-options',scopeId=''}){
  return <div className={className}>
    {[
      ['search','features.search.title'],
      ['statistics_able','features.statics.title'],
      ['culture_able','features.culture.title'],
      ...(isUnifiedAnchorScope(scopeId)?[['trace','features.trace.title']]:[])
    ].map(([key,label])=><label key={key}>
      <input type="checkbox" checked={scopeFeatureEnabled(value,key)}
        onChange={event=>onChange?.(key,event.target.checked)}/><UiText id={label}/>
    </label>)}
  </div>;
}
