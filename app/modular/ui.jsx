'use client';
import UiText,{useUiText} from '../i18n/UiText';

import {createContext,useContext,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {animate,motion,useReducedMotion} from 'motion/react';
import {scopeFeatureEnabled} from '../loc/scope/scope-config-fields.mjs';
import dynamic from 'next/dynamic';
import {usePathname} from 'next/navigation';
import {useEditDock} from './edit-dock';
import {useAsyncResource} from '../../packages/zenstack/client-queries';
import {UI_COPY} from '../i18n/ui-copy';
import {useUiCopy,useUiLocale} from '../i18n/ui-locale';
import {DEFAULT_LIST_BATCH_SIZE,LIST_LOAD_COOLDOWN_MS} from '../loc/db/db-contract.mjs';
import {useScopeRuntime} from './use-scope-runtime';
import {hero_block,selectLiveScopeBlocks} from '../loc/scope/scope-data';
import {heroImageUrlForPage} from '../loc/blocks/hero-image.mjs';

import {HomeBlock} from '../loc/blocks/home-block-model';
import ScopeLink from './ScopeLink';
import {featureNavigationHref} from './routing/feature-navigation';
import {scopeHref} from './routing/scope-registry';
// Shared display stays light: mount the editor only on pages that need it.
const BlockNoteEditor=dynamic(()=>import('../loc/editor/BlockNoteEditor'),{loading:()=>null});
const ArticleTimeAnchorAction=dynamic(()=>import('./ArticleTimeAnchorAction'),{loading:()=>null});

export const ManagementHeroContext=createContext('');

function FeatureHeroContent({eyebrow='',title,subtitle='',description='',rich=false,scopeId=''}){
  const subtitleText=HomeBlock.plainBlockLine(subtitle);
  const descriptionHtml=String(description||'').trim();
  const hasDescription=Boolean(HomeBlock.plainBlockLine(descriptionHtml)||
    /<(?:img|picture|video|audio|iframe|svg)\b/i.test(descriptionHtml));
  return <div className="scope-feature-hero-copy">
    {eyebrow?<p className="loc-eyebrow scope-feature-hero-copy__eyebrow">{eyebrow}</p>:null}
    <div className="home-title-row">
      <h1 className="scope-feature-hero-copy__title">{title}</h1>
      {subtitleText?<p className="loc-subtitle scope-subtitle scope-feature-hero-copy__subtitle">{subtitleText}</p>:null}
    </div>
    {hasDescription?(rich
      ?<div className="scope-hero-description scope-shared-hero-rich scope-feature-hero-copy__description" dangerouslySetInnerHTML={{__html:descriptionHtml}}/>
      :<div className="scope-hero-description scope-feature-hero-copy__description">{descriptionHtml}</div>):null}
  </div>;
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
  const managementView=useContext(ManagementHeroContext);
  const managementSlot=HomeBlock.managementHeroSlot(managementView,scopeId);
  const managementMode=Boolean(managementSlot);
  const sharedEnabled=HomeBlock.shouldUseSharedFeatureHero(scopeId,featureId);
  const artworkId=managementMode?'manage':featureId;
  const heroClassName='loc-card scope-hero scope-feature-hero'+(HomeBlock.FEATURE_HERO_ORDER[artworkId]?' scope-feature-hero--artwork scope-feature-hero--'+artworkId:'');
  const hasFeatureHero=Boolean(HomeBlock.FEATURE_HERO_ORDER[featureId]);
  // Static feature frame first; read the two fixed public Hero slots in
  // one existing Query. Editing retains its independent authoritative rows.
  const groupHeroPage=HomeBlock.featureHeroPageFor(featureId);
  const publicHeroQuery=useAsyncResource(['scope-public-hero',featureId],
    ()=>hero_block([groupHeroPage]),{
      enabled:hasFeatureHero&&!managementMode
    });
  const publicRows=publicHeroQuery.data||[];
  const groupHeroRows=publicRows.filter(row=>row.page_name===groupHeroPage);
  const managementTextPage=managementSlot?.page||'';
  const managementImagePage=HomeBlock.managementHeroImagePage(managementSlot);
  // Management Hero and the editor use the same mounted query key when
  // referring to the same page. One authoritative read serves both, and an
  // explicit Save can update the current result without another preflight.
  const managementTextQuery=useAsyncResource(['scope-blocks','loc',managementTextPage],
    ()=>selectLiveScopeBlocks('loc',managementTextPage),{enabled:managementMode});
  const managementImageQuery=useAsyncResource(['scope-blocks','loc',managementImagePage],
    ()=>selectLiveScopeBlocks('loc',managementImagePage),{enabled:managementMode});
  const heroImageRow=managementMode
    ?managementImageQuery.data?.find(row=>Number(row.block_order)===1)
    :groupHeroRows.find(row=>Number(row.block_order)===1);
  const heroImagePage=managementMode?managementImagePage:groupHeroPage;
  const heroImageOverride=heroImageUrlForPage(heroImageRow,'loc',heroImagePage)||
    (managementMode?HomeBlock.managementHeroDefaultImage(managementSlot)
      :hasFeatureHero?HomeBlock.featureHeroDefaultImage(featureId):'');
  const heroStyle=heroImageOverride?{'--scope-feature-hero-image':`url("${heroImageOverride}")`}:undefined;
  const shared=managementMode?HomeBlock.managementHeroCopy(managementTextQuery.data,managementSlot)
    :sharedEnabled?HomeBlock.featureHeroFor(groupHeroRows,groupHeroPage):null;
  const fallbackCopy={
    title:profile.title,
    subtitle:finalSubtitle,
    description:resolvedDescription
  };

  const publicFeature=!managementMode&&['culture','statics','search','trace'].includes(featureId)?featureId:'';
  const heroRef=useRef(null);
  const heroPlayed=useRef('');
  const contentRef=useRef(null);
  const contentPlayed=useRef('');
  const reduceMotion=useReducedMotion();
  const heroIdentity=[scopeId,pathname,featureId,managementTextPage].join('|');
  const heroReady=managementMode?managementTextQuery.isSuccess:
    !hasFeatureHero||publicHeroQuery.isSuccess;
  useLayoutEffect(()=>{
    if(!heroReady||!heroRef.current||heroPlayed.current===heroIdentity)return;
    heroPlayed.current=heroIdentity;
    if(reduceMotion||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    const direction=featureId==='culture'?{x:[-9,0]}:
      featureId==='trace'?{x:[9,0]}:featureId==='statics'?{y:[7,0]}:{y:[4,0]};
    const elements=heroRef.current.querySelectorAll(':scope > .loc-eyebrow, :scope > .home-title-row, :scope > .scope-hero-description');
    const controls=Array.from(elements).map((element,index)=>{
      const original={opacity:element.style.opacity,transform:element.style.transform};
      const restore=()=>Object.assign(element.style,original);
      const control=animate(element,{opacity:[.65,1],...direction},
        {duration:.28,delay:index*.045,ease:'easeOut',onComplete:restore});
      return ()=>{control.stop();restore();};
    });
    return ()=>controls.forEach(stop=>stop());
  },[heroReady,heroIdentity,featureId,reduceMotion]);
  useLayoutEffect(()=>{
    const element=contentRef.current;
    if(!element||contentPlayed.current===heroIdentity)return;
    contentPlayed.current=heroIdentity;
    if(reduceMotion||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    const original={opacity:element.style.opacity,transform:element.style.transform};
    const restore=()=>Object.assign(element.style,original);
    const control=animate(element,{opacity:[.9,1],y:[5,0]},
      {duration:.24,ease:'easeOut',onComplete:restore});
    return ()=>{control.stop();restore();};
  },[heroIdentity,reduceMotion]);
  return <main className={'scope-main'+(managementMode?' scope-main--edit-workspace':'')} data-public-feature={publicFeature||undefined}>
    <section className="scope-page">
      <header ref={heroRef} className={heroClassName} style={heroStyle} data-feature-hero-source={managementMode?managementTextPage:shared?'loc':'default'}>
        <FeatureHeroContent
          scopeId={scopeId}
          eyebrow={shared?.eyebrow||''}
          title={managementMode?shared?.title||managementSlot.label:titleOverride||shared?.title||fallbackCopy.title}
          subtitle={managementMode?shared?.subtitle||'':shared?shared.subtitle:fallbackCopy.subtitle}
          description={managementMode?shared?.description||'':shared?shared.description:fallbackCopy.description}
          rich={Boolean(shared)&&(!managementMode||/<[a-z][^>]*>/i.test(shared?.description||''))}
        />
        {(managementMode?(managementTextQuery.isError||managementImageQuery.isError):publicHeroQuery.isError)
          ?<p className="scope-status scope-error" role="alert">主視覺資料讀取失敗，請重新整理。</p>:null}
        {(managementMode?managementTextQuery.isSuccess&&!shared:hasFeatureHero&&publicHeroQuery.isSuccess&&sharedEnabled&&!shared)
          ?<p className="scope-status" role="status">尚無主視覺資料。</p>:null}
      </header>
      <div ref={contentRef} className={"scope-content"+(publicFeature?" loc-public-content":"")}>
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
    {open&&!loading&&!error?<div className="scope-article-block-display"
      role="region" aria-label={copy.work.viewBody}>
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
    from:day,to:day,...(kind==='lucus'?{lucus:item.uid}:{period:item.uid})
  });
  const traceLink=(item,kind)=>featureNavigationHref(item?.source_scope||scope,'trace',
    kind==='place'?{place:item.uid}:{map:item.uid});
  const articles=items=>items.map((item,index)=>{
    const id=String(item.id||'');
    return <ScopeLink key={id||item.href||index} className="scope-article-context-link"
      href={item.href}>{item.title||item.label||'閱讀文章'}</ScopeLink>;
  });
  const named=(items,href)=>Array.isArray(items)?items.map((item,index)=>{
    return <ScopeLink key={item.uid||index} href={href(item)} className="scope-article-context-link">
      {item.title||item.uid}</ScopeLink>;
  }):[];
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
  const activeAnchors=Array.isArray(time.anchors)?[...time.anchors]:[];
  if(addedAnchor?.scope===scope&&addedAnchor?.day===day&&
    !activeAnchors.some(item=>item.uid===addedAnchor.lucus.uid))activeAnchors.push(addedAnchor.lucus);
  const timeAnchors=named(activeAnchors,item=>timeHref(item,'lucus'));
  const anniversarySuggestions=activeAnchors.length?[]:
    (Array.isArray(time.anniversarySuggestions)?time.anniversarySuggestions:[]);
  const periods=named(time.periods,item=>timeHref(item,'period'));
  const eras=named(time.eras,item=>timeHref(item,'period'));
  const locations=space.place?[space.place]:tracePlace?[tracePlace]:[];
  const places=named(locations,item=>traceLink(item,'place'));
  const routes=named(space.routes,item=>traceLink(item,'map'));
  const traces=named(space.traces,item=>traceLink(item,'map'));
  const timeRows=[];
  if(timeAnchors.length)timeRows.push(row('定錨',timeAnchors));
  else if(dateValid)timeRows.push(row('日期',<ScopeLink className="scope-article-context-link"
    href={featureNavigationHref(scope,'culture',{from:day,to:day})}>{day} · 查看時間長河</ScopeLink>));
  if(periods.length)timeRows.push(row('期間',periods));
  if(eras.length)timeRows.push(row('時代',eras));
  if(anniversarySuggestions.length)timeRows.push(row('週年建議',<span className="scope-status">
    {anniversarySuggestions[0].title} · 可新增週年定錨
  </span>));
  if(dateValid&&scope!=='loc'&&scope!=='local')timeRows.push(row('新增定錨',<ArticleTimeAnchorAction
    scopeId={scope} date={day} articleCreateTime={articleCreateTime}
    suggestions={anniversarySuggestions}
    label={anniversarySuggestions.length?'新增週年定錨':'新增時間定錨'}
    onCreated={lucus=>setAddedAnchor({scope,day,lucus})}/>));
  const spaceRows=[];
  if(places.length)spaceRows.push(row('地點',places));
  else if(String(locationName||'').trim())spaceRows.push(row('文章地點',String(locationName).trim()));
  if(routes.length)spaceRows.push(row('路線',routes));
  if(traces.length)spaceRows.push(row('痕跡圖',traces));
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
    {timeRows.length?<div className="scope-article-context-group">
      <h3>時間</h3>{timeRows}
    </div>:null}
    {spaceRows.length?<div className="scope-article-context-group">
      <h3>空間</h3>{spaceRows}
    </div>:null}
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
    {detailReading?<ArticleRelationNavigation links={safeRelations} externalLinks={showLinks?safeLinks:[]}
      relatedMedia={relatedMedia} relatedTime={relatedTime} relatedSpace={relatedSpace}
      relatedStatistics={relatedStatistics} articleScopeId={articleScopeId} articleDate={articleDate}
      articleCreateTime={articleCreateTime}
      tracePlace={tracePlace} traceHref={traceHref} locationName={locationName}/>:null}
    {children}
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
    },{root:scrollRootRef?.current||null,threshold:0,rootMargin:'640px 0px'});
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
      {scrollRootRef&&loading&&source.length>0?<p className='scope-status' role='status'>正在載入下一批文章；已載入內容保持顯示。</p>:null}
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
      ...(scopeId!=='loc'?[['trace','features.trace.title']]:[])
    ].map(([key,label])=><label key={key}>
      <input type="checkbox" checked={scopeFeatureEnabled(value,key)}
        onChange={event=>onChange?.(key,event.target.checked)}/><UiText id={label}/>
    </label>)}
  </div>;
}
