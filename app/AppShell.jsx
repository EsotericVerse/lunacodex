'use client';

import {useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import dynamic from 'next/dynamic';
import {Capacitor} from '@capacitor/core';
import {LayoutGroup,motion,useReducedMotion} from 'motion/react';
import {useQueryClient} from '../packages/zenstack/client-queries';
import {translateUiField,UI_COPY,UI_LOCALE_OPTIONS,normalizeUiLocale,uiCopy,uiLocaleLoadError} from './i18n/ui-copy';
import {UiLocaleProvider,useLoadedUiLocale,useUiLocale,useUiSection} from './i18n/ui-locale';
import FieldText from './i18n/FieldText';
import {FEATURES,SCOPES,featureIdForPath,getScope,normalizeScopeId} from './modular/routing/scope-registry';
import {SCOPE_ROUTE_INDEX} from './modular/routing/scope-route-index.js';
import {activatePublishedTheme,THEME_SLOTS} from './modular/theme-registry';
import {useScopeRuntime} from './modular/use-scope-runtime';
import {faviconForScope} from './site-favicons';
import {PUBLISHED_SITE_BOOTSTRAP} from './modular/published-site-bootstrap.js';
import {getDbSourceStatus,subscribeDbSourceStatus} from './loc/providers/db-source-status.mjs';
import {getLocalDeadline,subscribeLocalDeadline,stopLocalDeadline,hasExpiredLocalDeadline} from './loc/local/session.mjs';
import {navigationHref} from './modular/routing/scope-registry.js';
import PageResourceBoundary from './modular/PageResourceBoundary';
import {recoverChunkOnce} from './loc/ui/chunk-recovery.mjs';
import BottomNavIcon,{DockMotionIcon,DockActiveIndicator} from './modular/BottomNavIcon';
import {EditDockProvider,useEditDock} from './modular/edit-dock';
// Only individual Scope homepages download the opt-in management entry.
const ScopeHomeEditEntry=dynamic(()=>import('./loc/blocks/ScopeHomeEditEntry'),{loading:()=>null});
import ScrollableScopeNav from './modular/ScrollableScopeNav';
import ScopeLink,{isManagementHref} from './modular/ScopeLink';

const MOBILE_HOME_ID='myphone';
const mobileHomeHref=native=>native?'/my-phone/index.html':'/';

const SYSTEM_THEME_ID='system-default';
const DAY_THEME_ID='theme-7';
const NIGHT_THEME_ID='theme-1';
const THEME_TIME_ZONE='Asia/Taipei';
const NAV_SCOPES=Object.values(SCOPES)
  .filter(scope=>scope.nav)
  .sort((a,b)=>(a.nav.position==='before'?0:1)-(b.nav.position==='before'?0:1)||Number(a.nav.order||0)-Number(b.nav.order||0));

import FlashMessage from './loc/notifications/FlashMessage';

function DataSourceStatus({local=false}){
  const {copy}=useUiLocale();
  useUiSection('uiExtra.dataSourceStatus');
  const section=copy.uiExtra.dataSourceStatus||{};
  const status=useSyncExternalStore(subscribeDbSourceStatus,getDbSourceStatus,getDbSourceStatus);
  if(local)return <div className="scope-data-source-global">
    <details className="scope-data-source-details">
      <summary>{section.localTitle||UI_COPY.uiExtra.dataSourceStatus.localTitle}</summary>
      <div className="scope-data-source-values"><span>{section.localActive||UI_COPY.uiExtra.dataSourceStatus.localActive}</span></div>
    </details>
  </div>;
  const current=status.unavailable
    ?section.unavailable||''
    :status.degraded
      ?`${section.backup||''}（${status.backupLabel}）`
      :`${section.primary||''}（${status.primaryLabel}）`;
  return <div className={'scope-data-source-global'+(status.unavailable?' is-unavailable':status.degraded?' is-backup':'')}>
    <details className="scope-data-source-details" open={status.degraded||undefined}>
      <summary>{section.detailsTitle}</summary>
      <div className="scope-data-source-values">
        <span><FieldText text="主要資料來源："/>{status.primaryLabel}</span>
        <span><FieldText text="備用資料來源："/>{status.backupLabel||'未設定（選配）'}</span>
        <span><FieldText text="目前使用："/>{current}</span>
      </div>
    </details>
    {status.unavailable
      ?<span role="status"><FieldText text={status.backupLabel?"主要與備援資料來源目前皆無法讀取，部分內容可能暫時無法顯示。":"主要資料來源暫時無法讀取，且未設定備援資料庫。部分內容可能暫時無法顯示。"}/></span>
      :status.degraded?<span role="status"><FieldText text="備援資料可能有同步時間差。"/></span>:null}
  </div>;
}

function taipeiHour(date=new Date()){
  try{
    const parts=new Intl.DateTimeFormat('en-US',{
      timeZone:THEME_TIME_ZONE,
      hour:'2-digit',
      hourCycle:'h23'
    }).formatToParts(date);
    return Number(parts.find(part=>part.type==='hour')?.value);
  }catch{
    return date.getHours();
  }
}

function automaticThemeId(date=new Date()){
  const hour=taipeiHour(date);
  return hour>=6&&hour<18?DAY_THEME_ID:NIGHT_THEME_ID;
}

function nextThemeChangeDelay(date=new Date()){
  const parts=new Intl.DateTimeFormat('en-CA',{
    timeZone:THEME_TIME_ZONE,
    year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'
  }).formatToParts(date);
  const value=type=>Number(parts.find(part=>part.type===type)?.value);
  const year=value('year'),month=value('month'),day=value('day'),hour=value('hour');
  const nextHour=hour<6?6:hour<18?18:6;
  const nextDay=hour>=18?day+1:day;
  // Taipei has a fixed UTC+8 offset. Scheduling the next palette boundary
  // avoids waking the app every 30 seconds just to rediscover the same theme.
  const boundary=Date.UTC(year,month-1,nextDay,nextHour)-8*60*60_000;
  return Math.max(1,boundary-date.getTime()+25);
}

// A manual Theme choice is page-local. Session stores only the active
// system/default Theme number for continuity on the Admin landing.
const LAST_ACTIVE_THEME_KEY='loc-active-theme-id-v1';
function readLastActiveTheme(){
  try{
    const candidate=String(window.sessionStorage.getItem(LAST_ACTIVE_THEME_KEY)||'');
    return THEME_SLOTS.some(slot=>slot.id===candidate)?candidate:'';
  }catch{return '';}
}
function rememberActiveTheme(themeId){
  if(!THEME_SLOTS.some(slot=>slot.id===themeId))return;
  try{window.sessionStorage.setItem(LAST_ACTIVE_THEME_KEY,themeId);}catch{}
}
function ThemeSelect({scopeId,scopeMeta=null,copy=UI_COPY,defaultThemeIdOverride='',routeKey=''}){
  const reduceMotion=useReducedMotion();
  const scope=scopeMeta||getScope(String(scopeId||'').trim());
  // Scope defaults are owned by the Scope config table; the game route alone
  // has its own purpose-built temporary default, never persisted to the DB.
  const fixedDefaultThemeId=String(defaultThemeIdOverride||'').trim();
  // Published Theme metadata is immutable CSS and JS; this is a display-only control.
  const configEnabled=!fixedDefaultThemeId&&scope.id!=='loc'&&!scope.aggregateChildren&&scope.id!=='admin';
  // Published route metadata supplies this Scope's default Theme number.
  const publishedTheme=SCOPE_ROUTE_INDEX.find(row=>row.scope_id===scopeId)?.config?.theme;
  const configuredTheme=configEnabled?String(publishedTheme||'').trim():'';
  const configuredDefaultThemeId=configuredTheme===SYSTEM_THEME_ID?'':configuredTheme;
  const [selection,setSelection]=useState(()=>({scopeId,routeKey,themeId:SYSTEM_THEME_ID}));
  // Decorative local feedback. Manual selection is never stored.
  const [accentPulse,setAccentPulse]=useState(0);
  const [now,setNow]=useState(()=>new Date());
  // Applying a saved Scope default must also clear any temporary footer choice.
  // Otherwise the local preview can mask a successful database update.
  useEffect(()=>{
    const onSaved=event=>{
      if(event?.detail?.scopeId===scopeId)setSelection({scopeId,routeKey,themeId:SYSTEM_THEME_ID});
    };
    window.addEventListener('loc-scope-theme-saved',onSaved);
    return()=>window.removeEventListener('loc-scope-theme-saved',onSaved);
  },[scopeId,routeKey]);
  const selectedThemeId=selection.scopeId===scopeId&&selection.routeKey===routeKey
    ?selection.themeId:SYSTEM_THEME_ID;
  const systemDefaultThemeId=fixedDefaultThemeId||configuredDefaultThemeId||
    (scopeId==='admin'?readLastActiveTheme():'')||automaticThemeId(now);
  const effectiveThemeId=selectedThemeId===SYSTEM_THEME_ID?systemDefaultThemeId:selectedThemeId;
  // Published CSS owns the complete public palette. No Theme JSON import is
  // needed on ordinary Scope navigation.
  const themeChoices=THEME_SLOTS.map(item=>({id:item.id,label:item.label}));
  useEffect(()=>{
    if(selectedThemeId===SYSTEM_THEME_ID)rememberActiveTheme(effectiveThemeId);
    void activatePublishedTheme(effectiveThemeId);
  },[effectiveThemeId,selectedThemeId]);

  useEffect(()=>{
    if(selectedThemeId!==SYSTEM_THEME_ID||fixedDefaultThemeId||configuredDefaultThemeId)return undefined;
    let timer;
    const scheduleNextChange=()=>{
      timer=window.setTimeout(()=>{
        setNow(new Date());
        scheduleNextChange();
      },nextThemeChangeDelay());
    };
    setNow(new Date());
    scheduleNextChange();
    return ()=>window.clearTimeout(timer);
  },[selectedThemeId,fixedDefaultThemeId,configuredDefaultThemeId]);

  useEffect(()=>{
    // A manually selected Theme is a one-page preview, not a saved preference.
    setSelection({scopeId,routeKey,themeId:SYSTEM_THEME_ID});
    setAccentPulse(0);
  },[scopeId,routeKey]);

  return <label className="scope-theme-control">
    <span>{copy.common.theme}</span>
    <span className="scope-theme-control__swatch" aria-hidden="true">
      <span className="scope-theme-control__accent"/>
      <span className="scope-theme-control__gold"/>
      {accentPulse>0&&!reduceMotion?<motion.span key={scopeId+':'+accentPulse}
        className="scope-theme-control__pulse" aria-hidden="true"
        initial={{opacity:.65,scale:.65}} animate={{opacity:0,scale:1.7}}
        onAnimationComplete={()=>setAccentPulse(0)}
        transition={{duration:.48,ease:'easeOut'}}/>:null}
    </span>
    <select value={selectedThemeId} onChange={event=>{
      const next=event.target.value;
      if(next===selectedThemeId)return;
      setSelection({scopeId,routeKey,themeId:next});
      if(!reduceMotion)setAccentPulse(count=>count+1);
    }} aria-label={copy.common.theme}>
      <option value={SYSTEM_THEME_ID}>{copy.common.systemTheme}</option>
      {themeChoices.map(item=><option value={item.id} key={item.id}>{item.label}</option>)}
    </select>
  </label>;
}
function ScopePageCopy({scopeId,display_name}){
  const enabled=Boolean(scopeId)&&scopeId!=='loc'&&scopeId!=='admin';
  const pageCopy=enabled
    ?(PUBLISHED_SITE_BOOTSTRAP.page_copy||[]).find(row=>row.scope_id===scopeId)||null
    :null;
  useEffect(()=>{
    const title=String(pageCopy?.Title_TW||display_name||'').trim();
    if(title&&document.title!==title)document.title=title;
    const description=String(pageCopy?.Desc_TW||'').trim();
    if(description){
      let meta=document.head.querySelector('meta[name="description"]');
      if(!meta){
        meta=document.createElement('meta');
        meta.setAttribute('name','description');
        document.head.appendChild(meta);
      }
      if(meta.getAttribute('content')!==description)meta.setAttribute('content',description);
    }
  },[scopeId,display_name,pageCopy?.Title_TW,pageCopy?.Desc_TW]);
  return null;
}
function LanguageSelect({locale,onChange,copy=UI_COPY}){
  return <label className="scope-theme-control scope-language-control">
    <span>{copy.common.language||'語系'}</span>
    <select value={locale} onChange={event=>onChange?.(event.target.value)} aria-label={copy.common.language||'語系'}>
      {UI_LOCALE_OPTIONS.map(option=><option value={option.value} key={option.value}>{option.label}</option>)}
    </select>
  </label>;
}

function normalizePath(value='/'){
  const path=String(value||'/').replace(/\/+$/,'');
  return path||'/';
}

function targetIsCurrent(href,host,pathname){
  if(!host)return false;
  try{
    const url=new URL(href,'https://'+host);
    return url.hostname===host.split(':')[0]&&normalizePath(url.pathname)===normalizePath(pathname);
  }catch{return false;}
}

// A two-pixel progress indicator should not eagerly download motion/react
// on every route. Use native scroll-driven CSS; older browsers get a tiny,
// passive, requestAnimationFrame-throttled fallback.
function ScrollProgress(){
  const elementRef=useRef(null);
  useEffect(()=>{
    if(typeof CSS!=='undefined'&&CSS.supports?.('animation-timeline: scroll(root block)'))return undefined;
    let frame=0;
    const paint=()=>{
      frame=0;
      if(!elementRef.current)return;
      const height=Math.max(document.documentElement.scrollHeight,document.body?.scrollHeight||0);
      const remaining=height-window.innerHeight;
      const ratio=remaining>0?Math.max(0,Math.min(1,window.scrollY/remaining)):0;
      elementRef.current.style.transform='scaleX('+ratio+')';
    };
    const schedule=()=>{if(!frame)frame=window.requestAnimationFrame(paint);};
    paint();
    window.addEventListener('scroll',schedule,{passive:true});
    window.addEventListener('resize',schedule);
    return()=>{
      window.removeEventListener('scroll',schedule);
      window.removeEventListener('resize',schedule);
      if(frame)window.cancelAnimationFrame(frame);
    };
  },[]);
  return <div ref={elementRef} className="loc-scroll-progress"
    style={{transform:'scaleX(0)'}} aria-hidden="true"/>;
}

function NavTarget({href,label,current=false,native=false}){
  return current?<span className="scope-nav-current" aria-current="page">{label}</span>:<ScopeLink href={href} native={native}>{label}</ScopeLink>;
}

export default function AppShell({children}){
  // Resolve Scope exactly once for the Shell and pass the same route identity
  // to Edit Dock. Admin edits the LOC Group data but never inherits its role.
  const runtime=useScopeRuntime();
  const editorScopeId=runtime.pathname.startsWith('/my-phone')||runtime.scopeId==='local'
    ?'local':runtime.scope?.featureScope||runtime.scopeId;
  return <EditDockProvider key={runtime.scopeId} scopeId={editorScopeId}>
    <AppShellInner runtime={runtime}>{children}</AppShellInner>
  </EditDockProvider>;
}

function AppShellInner({children,runtime}){
  const queryClient=useQueryClient();
  useEffect(()=>{
    // Retire pre-existing browser copies of unfinished Timeline reviews and
    // settings snapshots. Do not touch LOC Auth or editor TTL session keys.
    try{
      const storage=window.sessionStorage;
      for(let i=storage.length-1;i>=0;i--){
        const key=storage.key(i);
        if(key&&(key.startsWith('loc-timeline-review:')||
            key==='loc-navigation-setting-snapshot-v1'||
            key==='loc-public-cache-policy-v1'))
          storage.removeItem(key);
      }
    }catch{}
  },[]);
  useEffect(()=>{
    // Register browser-only static asset caching. Native IPA remains separate;
    // SQL, public APIs, auth, HTML and images are never intercepted.
    if(Capacitor.isNativePlatform()||!('serviceWorker' in navigator)||
      !/^https?:$/.test(window.location.protocol))return;
    void navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'})
      .catch(()=>{});
  },[]);
  // Administrative Scope metadata updates refresh the shared ZenStack
  // query state consumed by the shell, runtime, and Guest feature pages.
  useEffect(()=>{
    const refreshLocal=()=>queryClient.invalidateQueries({predicate:query=>Array.isArray(query.queryKey)&&query.queryKey.some(part=>part==='local'||(typeof part==='string'&&part.startsWith('silver.local_')))});
    window.addEventListener('loc-local-data-changed',refreshLocal);
    return()=>{
      window.removeEventListener('loc-local-data-changed',refreshLocal);
    };
  },[queryClient]);
  const {scopeId,scope,host,pathname,registryRow,configRow}=runtime;
  // Settings is an LOC account page; its palette follows the source Scope.
  // This URL context does not change identity, permissions or database access.
  const settingsScopeId=['/settings','/settings/index.html','/local/settings','/local/settings/index.html'].includes(normalizePath(pathname))
    ?normalizeScopeId(new URLSearchParams(runtime.search||'').get('scopeid')):'';
  const themeScopeId=settingsScopeId&&settingsScopeId!=='admin'&&settingsScopeId!=='local'
    ?settingsScopeId:scopeId;
  const protectedEditorRoute=isManagementHref(pathname)||/^\/admin(?:\/|$)/i.test(String(pathname||''));
  const editDock=useEditDock();
  const [managementDenied,setManagementDenied]=useState(false);
  useEffect(()=>{
    setManagementDenied(false);
    const denied=event=>{
      if(event?.detail?.scopeId===scopeId||
        (/^\/admin(?:\/|$)/i.test(String(pathname||''))&&event?.detail?.scopeId==='loc'))
        setManagementDenied(true);
    };
    window.addEventListener('loc-management-entry-denied',denied);
    return()=>window.removeEventListener('loc-management-entry-denied',denied);
  },[pathname,scopeId]);
  useEffect(()=>{
    // Next can catch a failed lazy import before React reports the error.
    // Recover other failed chunk loads here, but never reload for SQL/RPC 404s.
    const recover=event=>{
      const target=event?.target;
      const script=target?.tagName==='SCRIPT'&&String(target.src||'').includes('/_next/static/')
        ?new Error('Failed to load chunk '+target.src):null;
      const failure=event?.reason||event?.error||script;
      if(!failure)return;
      try{void recoverChunkOnce(failure);}catch{}
    };
    window.addEventListener('error',recover,true);
    window.addEventListener('unhandledrejection',recover);
    return ()=>{
      window.removeEventListener('error',recover,true);
      window.removeEventListener('unhandledrejection',recover);
    };
  },[]);
  // Static export serves the same root HTML on multiple Scope subdomains.
  // Update the browser tab icon after the client resolves the actual Scope.
  useEffect(()=>{
    if(!host)return;
    let link=document.getElementById('loc-active-favicon');
    if(!link){
      link=document.createElement('link');
      link.id='loc-active-favicon';
      link.rel='icon';
      link.type='image/png';
      document.head.appendChild(link);
    }
    link.href=faviconForScope(scopeId);
  },[scopeId,host]);
  const currentFeature=featureIdForPath(pathname);
  const [dockActivation,setDockActivation]=useState({id:'',count:0});
  const [rainbowPreview,setRainbowPreview]=useState(false);
  useEffect(()=>{
    const onPreview=event=>setRainbowPreview(event?.detail?.active===true);
    window.addEventListener('loc-owner-rainbow-preview',onPreview);
    return()=>window.removeEventListener('loc-owner-rainbow-preview',onPreview);
  },[]);
  const isSettings=['/settings','/settings/index.html','/local/setting','/local/setting/index.html','/local/settings','/local/settings/index.html'].includes(normalizePath(pathname));
  const showRainbowPreview=rainbowPreview&&isSettings;
  const [native,setNative]=useState(false);
  const localDeadline=useSyncExternalStore(subscribeLocalDeadline,getLocalDeadline,()=>0);
  const lastLocalDeadline=useRef(0);
  // Phone-only expiry check on app resume and navigation; no background timer.
  useEffect(()=>{
    const check=()=>{if(hasExpiredLocalDeadline())stopLocalDeadline();};
    const onVisible=()=>{if(!document.hidden)check();};
    window.addEventListener('focus',check);window.addEventListener('pageshow',check);
    document.addEventListener('visibilitychange',onVisible);check();
    return()=>{window.removeEventListener('focus',check);window.removeEventListener('pageshow',check);document.removeEventListener('visibilitychange',onVisible);};
  },[]);
  // Fixed navigation/display metadata is available without query state.
  const registryScopes=PUBLISHED_SITE_BOOTSTRAP.registry||[];
  const navDisplayNames=Object.fromEntries((PUBLISHED_SITE_BOOTSTRAP.page_copy||[])
    .map(row=>[String(row.scope_id||''),String(row.Title_TW||'').trim()])
    .filter(([,label])=>label));
  useEffect(()=>setNative(Capacitor.isNativePlatform()),[]);
  const currentScope=scope||getScope(scopeId);
  // Only an explicit language change causes a document reload. One temporary
  // hand-off is removed immediately on the next document: there is no saved
  // language preference, no multi-locale preload and no cross-page carryover.
  const LANGUAGE_RELOAD_ONCE='loc-language-reload-once';
  const [manualLocale,setManualLocale]=useState(null);
  const [localeEntryReady,setLocaleEntryReady]=useState(false);
  useEffect(()=>{
    // Host-based Scope resolution finishes after hydration; do not consume
    // the one-shot language for a transient, incorrect default Scope.
    if(!runtime.locationMounted)return;
    let requested=null;
    try{
      const stored=window.sessionStorage.getItem(LANGUAGE_RELOAD_ONCE);
      window.sessionStorage.removeItem(LANGUAGE_RELOAD_ONCE);
      requested=stored?JSON.parse(stored):null;
    }catch{}
    const valid=requested?.scopeId===scopeId&&requested?.pathname===pathname&&
      UI_LOCALE_OPTIONS.some(option=>option.value===requested?.locale);
    setManualLocale(valid?requested:null);
    setLocaleEntryReady(true);
  },[scopeId,pathname,runtime.locationMounted]);
  const configLocaleEnabled=Boolean(scopeId)&&!currentScope.aggregateChildren&&scopeId!=='admin';
  const publishedLocale=SCOPE_ROUTE_INDEX.find(row=>row.scope_id===scopeId)?.config?.locale;
  const configuredLocale=configLocaleEnabled?normalizeUiLocale(publishedLocale):'zh-Hant';
  const activeLocale=manualLocale?.scopeId===scopeId&&manualLocale?.pathname===pathname
    ?manualLocale.locale:configuredLocale;
  const localeReady=useLoadedUiLocale(activeLocale,pathname,localeEntryReady);
  const changeLanguage=locale=>{
    const next=normalizeUiLocale(locale);
    if(next===activeLocale)return;
    const handoff={scopeId,pathname,locale:next};
    try{
      window.sessionStorage.setItem(LANGUAGE_RELOAD_ONCE,JSON.stringify(handoff));
      window.location.reload();
    }catch{
      // Storage-disabled environments still support a page-local selection.
      setManualLocale(handoff);
    }
  };
  const copy=useMemo(()=>uiCopy(activeLocale,pathname),[activeLocale,pathname,localeReady]);
  useEffect(()=>{document.documentElement.lang=activeLocale;},[activeLocale]);
  const isMyPhone=native&&['/my-phone','/my-phone/index.html'].includes(normalizePath(pathname));
  // /local and My Phone share the on-device Galaxy IndexedDB core.
  const localWorkspace=native&&(isMyPhone||scopeId==='local');
  const localCoreActive=native&&localDeadline>0;
  const localNavigation=localWorkspace||localCoreActive;
  useEffect(()=>{
    if(!native)return;
    if(!localCoreActive&&localWorkspace&&hasExpiredLocalDeadline()){
      stopLocalDeadline();
      window.location.replace('/?loc_direct=1');
      return;
    }
    if(localCoreActive){
      lastLocalDeadline.current=localDeadline;
      if(!localWorkspace)window.location.replace('/local/index.html');
      return;
    }
    if(lastLocalDeadline.current){
      lastLocalDeadline.current=0;
      if(localWorkspace)window.location.replace('/?loc_direct=1');
    }
  },[native,localCoreActive,localDeadline,localWorkspace]);
  const navScopeId=!native&&currentScope.nativeOnly?'loc':localNavigation?'local':currentScope.featureScope||scopeId;
  const gameThemeDefault=/(^|\/)game\/?$/.test(String(pathname||''))?'theme-4':'';

  useEffect(()=>{
    if(typeof document!=='undefined')document.documentElement.lang=activeLocale;
  },[activeLocale]);
  // Render canonical Scope routes on web and native, in Registry NAV order.
  // The former per-user Favorites/Folder selection no longer exists.
  // NAV: Rune first, author second, remaining Scopes in the rail.
  // LOC stays pinned on the far right, outside the scrollable Scope rail.
  const navigationScopes=NAV_SCOPES
    .filter(item=>item.id!=='loc'&&item.id!=='admin')
    .map(item=>({id:item.id,label:navDisplayNames[item.id]||
      (item.id==='lrunes'?copy.nav.lunarunes:item.id==='lo3rwang'?copy.nav.author:item.nav.label)}));
  if(!native){
    const listed=new Set(navigationScopes.map(item=>item.id));
    for(const row of registryScopes){
      const id=String(row.scope_id||'');
      if(!id||id==='loc'||id==='admin'||id==='local'||row.active===false||listed.has(id))continue;
      navigationScopes.push({id,label:navDisplayNames[id]||row.display_name||id});
      listed.add(id);
    }
  }else{
    navigationScopes.push({id:MOBILE_HOME_ID,
      label:translateUiField(activeLocale,'我的手機')});
  }
  const editScopeAvailable=navScopeId!=='loc'&&navScopeId!=='admin'&&!currentScope.aggregateChildren;
  // A Scope homepage may live at /, /scopeid/, /scope-shell/ or /scopeid/index.html.
  const homeParts=String(pathname||'/').split('/').filter(Boolean);
  if(homeParts.at(-1)==='index.html')homeParts.pop();
  const isScopeHomepage=homeParts.length===0||
    (homeParts.length===1&&(homeParts[0]===scopeId||homeParts[0]==='scope-shell'));
  // LOC's homepage has its own Admin-only editor; individual Scopes have
  // Scope-only editors. Both entries are visible to guests until clicked.
  const showHomeEditEntry=isScopeHomepage&&scopeId!=='local'&&Boolean(scopeId)&&
    (scopeId==='loc'||(editScopeAvailable&&(!currentScope.nativeOnly||native)));
  // Keep existing query parameters (especially dynamic scopeid) on iOS and web.
  const editTabHref=(route,key,value)=>{
    const href=navigationHref(navScopeId,route,native);
    return href+(href.includes('?')?'&':'?')+
      encodeURIComponent(key)+'='+encodeURIComponent(value);
  };
  const editingDockVisible=Boolean(editDock?.active&&editDock.scopeId===navScopeId);
  const editDockPending=!editingDockVisible&&protectedEditorRoute&&!managementDenied;
  const locAdminEdit=navScopeId==='loc';
  const editSegments=String(pathname||'').split('/').filter(Boolean);
  const editSection=typeof window!=='undefined'
    ?new URLSearchParams(window.location.search).get('section'):'';
  const featureEditReturn=editSegments.includes('culture')?'culture'
    :editSegments.includes('statics')&&(editSegments.includes('keywords')||editSegments.includes('manage'))?'statics'
    :editSegments.includes('search')&&(editSegments.includes('manage')||editSegments.includes('admin'))?'search'
    :editSegments.includes('trace')&&editSegments.includes('manage')?'trace'
    :null;
  const isFeatureEditMode=Boolean(editingDockVisible&&featureEditReturn);
  // Each editing level has exactly four destinations + Save + Discard.
  // Group edit dock: System Admin replaces the old first slot, and
  // People/Works replaces Trace Map. Admin access is still checked by
  // ManagementAccess at /admin/; the dock grants no privileges.
  const editDestinations=locAdminEdit?[
    ...(editDock?.canManageGlobal?[{id:'system',icon:'settings',label:translateUiField(activeLocale,'系統管理'),
      href:'/admin/'}]:[]),
    {id:'keywords',icon:'keywords',label:translateUiField(activeLocale,'關鍵詞'),
      href:editTabHref('statics/manage','edit','1')},
    {id:'members',icon:'culture',label:translateUiField(activeLocale,'人員作品管理'),
      href:editTabHref('culture/manage','edit','1')},
    {id:'suggestions',icon:'search',label:translateUiField(activeLocale,'文章管理'),
      href:editTabHref('search/manage','section','publish')+'&edit=1'}
  ]:[
    {id:'time',icon:'culture',label:translateUiField(activeLocale,'時間定錨'),
      href:editScopeAvailable?editTabHref('culture/manage','edit','1'):''},
    {id:'keywords',icon:'keywords',label:translateUiField(activeLocale,'關鍵詞'),
      href:editScopeAvailable&&navScopeId!=='local'?editTabHref('statics/manage','edit','1'):''},
    {id:'manage',icon:'trace',label:navScopeId==='local'?'管理':translateUiField(activeLocale,'空間定錨'),
      href:navScopeId==='local'?navigationHref('local','manage',native)
        :editTabHref('manage','section','anchor')+'&edit=1'},
    {id:'suggestions',icon:'search',label:translateUiField(activeLocale,'文章管理'),
      href:navScopeId==='local'?navigationHref('local','search',native)
        :editTabHref('search/manage','section','publish')+'&edit=1'}
  ];
  const editTabs=[
    {id:'save',icon:'save',label:translateUiField(activeLocale,'儲存'),action:'save'},
    ...editDestinations,
    {id:'cancel',icon:'cancel',label:translateUiField(activeLocale,'取消'),action:'cancel'}
  ];
  const featureTabs=[
    {id:'home',icon:'home',label:translateUiField(activeLocale,'首頁'),
      href:localNavigation?navigationHref('local','',native):
        navigationHref(navScopeId,'',native)},
    ...['culture','statics','trace','search'].map(id=>{
      const feature=FEATURES.find(item=>item.id===id);
      return {id,icon:id,label:copy.features?.[id]?.title||feature.label,
        href:navigationHref(localNavigation?'local':navScopeId,feature.path,native)};
    }),
    {id:'settings',icon:'settings',label:copy.common.settings||'設定',
      href:native?'/local/settings/index.html?scopeid='+encodeURIComponent(navScopeId)+(localNavigation?'&section=local':'')
        :'/settings/?scopeid='+encodeURIComponent(navScopeId)}
  ];

  // Never hide the permanent navigation/footer/dock while one page's
  // language JSON loads. Only that page's own content waits for its text.
  const localeError=localeReady?null:uiLocaleLoadError(activeLocale,pathname);
  return <UiLocaleProvider locale={activeLocale} pathname={pathname}>
    <ScopePageCopy scopeId={localNavigation?'local':scopeId}
      display_name={localNavigation?'本機銀河':configRow?.display_name||registryRow?.display_name}
/>
    <ScrollProgress/>
    <header className="scope-global" data-native={native?'ios':'web'}>
      <nav className="scope-nav" aria-label={copy.nav.aria}>
        <ScrollableScopeNav label="Scope 導覽"
          resetKey={navigationScopes.map(item=>item.id+':'+item.label).join('|')}>
          {navigationScopes.map(item=>{
            const href=item.id===MOBILE_HOME_ID
              ?mobileHomeHref(native):navigationHref(item.id,'',native);
            return <NavTarget key={item.id} href={href} label={item.label}
              current={targetIsCurrent(href,host,pathname)} native={native}/>;
          })}
        </ScrollableScopeNav>
        <ScopeLink href={navigationHref('loc','',native)} native={native}
          className="scope-nav-loc-home"
          aria-current={targetIsCurrent(navigationHref('loc','',native),host,pathname)?'page':undefined}>
          {copy.nav.home}
        </ScopeLink>
      </nav>
    </header>
    <PageResourceBoundary routeKey={scopeId+'|'+normalizePath(pathname)}>
      {!localeReady?<main className="scope-main"><section className="scope-page">
        {localeError?<><p role="alert">無法載入這一頁的語系文字。</p>
          <button type="button" onClick={()=>window.location.reload()}>重新載入</button></>
          :<p className="scope-status" role="status">正在載入頁面文字…</p>}
      </section></main>:localCoreActive&&!localWorkspace
        ?<main className="scope-main"><p className="scope-status" role="status">正在切換手機本機資料…</p></main>
        :children}
    </PageResourceBoundary>
    <motion.div layoutRoot className="scope-feature-dock scope-floating-edit-buttons" role="toolbar"
      aria-label={translateUiField(activeLocale,editingDockVisible||editDockPending?'編輯功能選單':'Scope 功能選單')}
      data-scope={localNavigation?'local':scopeId} data-local-core={localCoreActive?'active':undefined} data-action-count={editingDockVisible?editTabs.length:6}>
      {editingDockVisible?editTabs.map(tab=>tab.action
        ?<button type="button" key={tab.id} className="scope-edit-dock-action"
          disabled={editDock.busy&&tab.action!=='cancel'}
          onClick={()=>tab.action==='save'
            ?editDock.save({exitOnSuccess:isScopeHomepage})
            :editDock.discard(navigationHref(navScopeId,isFeatureEditMode?featureEditReturn:'',native),
              {confirmOnlyWhenDirty:isFeatureEditMode})}>
          <BottomNavIcon name={tab.icon}/><span>{tab.label}</span>
        </button>
        :tab.href?<button type="button" key={tab.id} disabled={editDock.busy}
            onClick={()=>editDock.switchTo(tab.href)}>
            <BottomNavIcon name={tab.icon}/><span>{tab.label}</span>
          </button>
          :<button type="button" key={tab.id} disabled>
            <BottomNavIcon name={tab.icon}/><span>{tab.label}</span>
          </button>)
      :editDockPending?<span role="status" className="scope-edit-dock-pending">正在確認編輯介面…</span>
      :<LayoutGroup id={'loc-six-key-dock-'+(localNavigation?'local':scopeId)}>
        {featureTabs.map(tab=>{
          const selected=tab.id==='settings'?isSettings:
            !isSettings&&(tab.id==='home'
              ?(localWorkspace?(isMyPhone||isScopeHomepage):isScopeHomepage)
              :currentFeature===tab.id);
          return <ScopeLink key={tab.id} href={tab.href} native={native}
            onClick={()=>{
               // ScopeLink now handles route cleanup once for all links,
               // including the six-button dock.
               setDockActivation(prev=>({id:tab.id,count:prev.count+1}));
             }}
            aria-current={selected?'page':undefined}>
            {selected?<DockActiveIndicator/>:null}
            <DockMotionIcon name={tab.icon} active={selected}
              activation={dockActivation.id===tab.id?dockActivation.count:0}/>
            <span>{tab.label}</span>
          </ScopeLink>;
        })}
      </LayoutGroup>}
      {showRainbowPreview&&!localCoreActive?<output className="scope-rainbow-preview-clock" aria-label="彩虹變身預覽，靜態十五分鐘" aria-live="off">彩虹預覽 · 15:00</output>:null}
      {localCoreActive?<output className="scope-local-core-timer" aria-live="off">本機資料庫 · 測試中（不倒數）</output>:null}
      {editingDockVisible&&editDock.notice?<p className="scope-edit-dock-notice" role="status" aria-live="polite">{editDock.notice}</p>:null}
    </motion.div>
    {showHomeEditEntry&&!localCoreActive?<ScopeHomeEditEntry key={scopeId}/>:null}
    <footer className="scope-footer" data-scope={scopeId}>
      <div className="scope-footer-row">
        <a href="mailto:sopa2306@gmail.com">{copy.nav.contact}</a>
        {(!isSettings||runtime.locationMounted)?<ThemeSelect scopeId={themeScopeId} scopeMeta={themeScopeId===scopeId?currentScope:getScope(themeScopeId)} copy={copy} defaultThemeIdOverride={gameThemeDefault} routeKey={pathname}/>:null}
        <LanguageSelect
          locale={activeLocale}
          copy={copy}
          onChange={changeLanguage}
        />
        <small className="scope-footer-date-basis" aria-label={({'zh-Hant':'日期基準','zh-Hans':'日期基准',en:'Date basis',ja:'日付基準'}[activeLocale]||'日期基準')+'：Asia/Taipei (UTC+08:00)'}>
          {({'zh-Hant':'日期基準','zh-Hans':'日期基准',en:'Date basis',ja:'日付基準'}[activeLocale]||'日期基準')+'：Asia/Taipei (UTC+08:00)'}
        </small>
      </div>
      <DataSourceStatus local={localNavigation}/>
      <FlashMessage/>
    </footer>
  </UiLocaleProvider>;
}
