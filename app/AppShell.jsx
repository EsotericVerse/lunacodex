'use client';

import {useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import dynamic from 'next/dynamic';
import {Capacitor} from '@capacitor/core';
import {LayoutGroup,motion,useReducedMotion} from 'motion/react';
import {useAsyncResource,useQueryClient} from '../packages/zenstack/client-queries';
import {translateUiField,UI_COPY,UI_LOCALE_OPTIONS,normalizeUiLocale,uiCopy,uiLocaleLoadError} from './i18n/ui-copy';
import {UiLocaleProvider,useLoadedUiLocale,useUiLocale,useUiSection} from './i18n/ui-locale';
import FieldText from './i18n/FieldText';
import {FEATURES,SCOPES,featureIdForPath,getScope,normalizeScopeId} from './modular/routing/scope-registry';
import {selectScopeConfig} from './loc/scope/scope-data';
import {readPublicHomePageCopy} from './loc/actions/blocks/queries.mjs';
import {activatePublishedTheme,THEME_SLOTS} from './modular/theme-registry';
import {useScopeRuntime} from './modular/use-scope-runtime';
import {faviconForScope} from './site-favicons';
import {PUBLISHED_SITE_BOOTSTRAP} from './modular/published-site-bootstrap.js';
import {getLocalDeadline,subscribeLocalDeadline,stopLocalDeadline,hasExpiredLocalDeadline} from './loc/local/session.mjs';
import {navigationHref} from './modular/routing/scope-registry.js';
import {managementRouteHref} from './modular/routing/management-route-table.mjs';
import PageResourceBoundary from './modular/PageResourceBoundary';
import {recoverChunkOnce} from './loc/ui/chunk-recovery.mjs';
import {DockMotionIcon,DockActiveIndicator} from './modular/BottomNavIcon';
import {EditDockProvider,useEditDock} from './modular/edit-dock';
import {PRIMARY_NAV_ORDER} from './modular/routing/navigation-order.mjs';
// Only individual Scope homepages download the opt-in management entry.
const ScopeHomeEditEntry=dynamic(()=>import('./loc/blocks/ScopeHomeEditEntry'),{loading:()=>null});
import ScrollableScopeNav from './modular/ScrollableScopeNav';
import ScopeLink from './modular/ScopeLink';

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

// The active selection belongs only to this browser document.
let activeDocumentTheme='';
function readLastActiveTheme(){
  return typeof window==='undefined'?'':activeDocumentTheme;
}
function rememberActiveTheme(themeId){
  if(typeof window!=='undefined'&&THEME_SLOTS.some(slot=>slot.id===themeId))
    activeDocumentTheme=themeId;
}
function ThemeSelect({scopeId,scopeMeta=null,copy=UI_COPY,defaultThemeIdOverride='',pageName='index'}){
  const reduceMotion=useReducedMotion();
  const scope=scopeMeta||getScope(String(scopeId||'').trim());
  // Scope defaults are owned by the Scope config table; the game route alone
  // has its own purpose-built temporary default, never persisted to the DB.
  const fixedDefaultThemeId=String(defaultThemeIdOverride||'').trim();
  // Palette styles are published CSS; the default theme belongs to this Scope.
  const configEnabled=!fixedDefaultThemeId&&scope.id!=='loc'&&scope.id!=='local'&&!scope.aggregateChildren&&scope.id!=='admin';
  const [committedScopeTheme,setCommittedScopeTheme]=useState({scopeId,themeId:''});
  const [themePreview,setThemePreview]=useState({scopeId,themeId:''});
  const committedId=committedScopeTheme.scopeId===scopeId?committedScopeTheme.themeId:'';
  const configuredTheme=configEnabled?committedId:'';
  const configuredDefaultThemeId=configuredTheme===SYSTEM_THEME_ID?'':configuredTheme;
  const [selection,setSelection]=useState({scopeId,themeId:SYSTEM_THEME_ID});
  // Decorative local feedback only when a person selects a different option.
  // Theme persistence and actual palette application remain untouched.
  const [accentPulse,setAccentPulse]=useState(0);
  const [now,setNow]=useState(()=>new Date());
  const themeRevision=useRef(0);
  useEffect(()=>{
    if(!configEnabled)return undefined;
    let active=true;
    const revision=themeRevision.current;
    selectScopeConfig(scopeId).then(row=>{
      if(!active||themeRevision.current!==revision)return;
      const themeId=String(row?.theme||'');
      if(themeId!==SYSTEM_THEME_ID&&!THEME_SLOTS.some(slot=>slot.id===themeId))return;
      setCommittedScopeTheme({scopeId,themeId});
    }).catch(error=>console.error('Scope theme read failed',error));
    return()=>{active=false;};
  },[scopeId,configEnabled]);
  // Management emits a temporary preview on selection. Abandoning the
  // editor removes it. Only a committed editor read/Save updates the local
  // runtime default; CSS is always the same published theme-N.css artifact.
  useEffect(()=>{
    const forScope=event=>event?.detail?.scopeId===scopeId;
    const onPreview=event=>{
      if(forScope(event))setThemePreview({scopeId,themeId:String(event.detail.themeId||'')});
    };
    const onClear=event=>{
      if(forScope(event))setThemePreview({scopeId,themeId:''});
    };
    const onCommitted=event=>{
      if(!forScope(event))return;
      const themeId=String(event.detail.themeId||'');
      themeRevision.current++;
      if(themeId!==SYSTEM_THEME_ID&&!THEME_SLOTS.some(slot=>slot.id===themeId))return;
      setCommittedScopeTheme({scopeId,themeId});
    };
    const onSaved=event=>{
      if(!forScope(event))return;
      onCommitted(event);
      setSelection({scopeId,themeId:SYSTEM_THEME_ID});
      setThemePreview({scopeId,themeId:''});
    };
    window.addEventListener('loc-scope-theme-preview',onPreview);
    window.addEventListener('loc-scope-theme-preview-clear',onClear);
    window.addEventListener('loc-scope-theme-committed',onCommitted);
    window.addEventListener('loc-scope-theme-saved',onSaved);
    return()=>{
      window.removeEventListener('loc-scope-theme-preview',onPreview);
      window.removeEventListener('loc-scope-theme-preview-clear',onClear);
      window.removeEventListener('loc-scope-theme-committed',onCommitted);
      window.removeEventListener('loc-scope-theme-saved',onSaved);
    };
  },[scopeId]);
  const selectedThemeId=selection.scopeId===scopeId?selection.themeId:SYSTEM_THEME_ID;
  const systemDefaultThemeId=fixedDefaultThemeId||configuredDefaultThemeId||
    (scopeId==='admin'?readLastActiveTheme():'')||automaticThemeId(now);
  const temporaryPreview=themePreview.scopeId===scopeId?themePreview.themeId:'';
  const effectiveThemeId=temporaryPreview===SYSTEM_THEME_ID?systemDefaultThemeId:
    THEME_SLOTS.some(slot=>slot.id===temporaryPreview)?temporaryPreview:
      selectedThemeId===SYSTEM_THEME_ID?systemDefaultThemeId:selectedThemeId;
  // Published CSS owns the complete public palette. No Theme JSON import is
  // needed on ordinary Scope navigation.
  const themeChoices=THEME_SLOTS.map(item=>({id:item.id,label:item.label}));
  useEffect(()=>{
    rememberActiveTheme(effectiveThemeId);
    // Preserve the current theme until its replacement CSS is loaded.
    // Unchanged Theme IDs perform no additional HTTP request.
    void activatePublishedTheme(effectiveThemeId);
  },[effectiveThemeId]);

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
    // A visitor's temporary choice is not persisted across Scope changes.
    setSelection({scopeId,themeId:SYSTEM_THEME_ID});
    setCommittedScopeTheme({scopeId,themeId:''});
    setThemePreview({scopeId,themeId:''});
    setAccentPulse(0);
  },[scopeId]);

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
      setSelection({scopeId,themeId:next});
      if(!reduceMotion)setAccentPulse(count=>count+1);
    }} aria-label={copy.common.theme}>
      <option value={SYSTEM_THEME_ID}>{copy.common.systemTheme}</option>
      {themeChoices.map(item=><option value={item.id} key={item.id}>{item.label}</option>)}
    </select>
  </label>;
}
function ScopePageCopy({scopeId,display_name,pageCopy}){
  const enabled=Boolean(scopeId)&&scopeId!=='local'&&scopeId!=='admin';
  useEffect(()=>{
    const title=String(pageCopy?.title_tw||pageCopy?.display_name||display_name||'').trim();
    if(title&&document.title!==title)document.title=title;
    const description=String(pageCopy?.desc_tw||'').trim();
    if(description){
      let meta=document.head.querySelector('meta[name="description"]');
      if(!meta){
        meta=document.createElement('meta');
        meta.setAttribute('name','description');
        document.head.appendChild(meta);
      }
      if(meta.getAttribute('content')!==description)meta.setAttribute('content',description);
    }else if(enabled&&pageCopy){
      document.head.querySelector('meta[name="description"]')?.remove();
    }
  },[scopeId,display_name,pageCopy?.title_tw,pageCopy?.display_name,
    pageCopy?.desc_tw,enabled]);
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

function RainbowDockFrame({index}){
  const reduced=useReducedMotion();
  return <motion.span className="scope-dock-rainbow-frame" aria-hidden="true"
    style={{'--loc-rainbow-angle':(index*60)+'deg'}}
    initial={reduced?false:{opacity:0,scale:.88}}
    animate={{opacity:1,scale:1}}
    transition={{duration:reduced?0:.48,delay:reduced?0:index*.055,ease:'easeOut'}}/>;
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
  const featureIndexScope=runtime.scope?.featureScope||runtime.scopeId;
  const canWarmFeatureIndexes=Boolean(featureIndexScope&&
    !['local','admin'].includes(featureIndexScope));
  // These are the light navigation indexes only. Era links load their related
  // period/date anchors by UID; the Trace index lists saved route/trace maps,
  // never all historical places or article bodies.
  useAsyncResource({
    queryKey:['culture-time-periods',featureIndexScope],
    enabled:canWarmFeatureIndexes&&featureIndexScope!=='loc',
    queryFn:async()=>{
      const {selectScopeCultureEraIndex}=await import('./loc/culture/query');
      return selectScopeCultureEraIndex(featureIndexScope);
    },
    revalidateOnFocus:false,revalidateOnReconnect:false
  });
  useAsyncResource({
    queryKey:['trace-map-index',featureIndexScope],
    enabled:canWarmFeatureIndexes,
    queryFn:async()=>{
      const {readTraceMapIndex}=await import('./modular/features/trace/trace-data');
      return readTraceMapIndex(featureIndexScope);
    },
    revalidateIfStale:false,revalidateOnFocus:false,revalidateOnReconnect:false
  });
  const [publicPageCopy,setPublicPageCopy]=useState([]);
  useEffect(()=>{
    const url=new URL(window.location.href);
    if(!url.searchParams.has('section'))return;
    url.searchParams.delete('section');
    window.history.replaceState(window.history.state,'',url.pathname+url.search+url.hash);
  },[runtime.pathname]);
  useEffect(()=>{
    let active=true;
    const refresh=()=>{
      void readPublicHomePageCopy().then(result=>{
        if(active&&Array.isArray(result?.data))setPublicPageCopy(result.data);
      }).catch(()=>{});
    };
    refresh();
    window.addEventListener('loc-public-scope-metadata-changed',refresh);
    return()=>{
      active=false;
      window.removeEventListener('loc-public-scope-metadata-changed',refresh);
    };
  },[]);
  useEffect(()=>{
    // LOC Web Service Worker is temporarily disabled in ALL environments.
    // Retire only this site's former worker and its own static asset caches.
    // Do not clear browser storage, SQL data, OAuth or other worker registrations.
    if(Capacitor.isNativePlatform()||!('serviceWorker' in navigator)||
      !/^https?:$/.test(window.location.protocol))return;
    void (async()=>{
      const swUrl=new URL('/sw.js',window.location.href).href;
      const registrations=await navigator.serviceWorker.getRegistrations();
      const old=registrations.filter(reg=>[reg.active,reg.waiting,reg.installing]
        .some(worker=>worker?.scriptURL===swUrl));
      await Promise.all(old.map(reg=>reg.unregister()));
      if('caches' in window){
        const names=await caches.keys();
        await Promise.all(names.filter(name=>
          name.startsWith('loc-static-next-')||
          name.startsWith('loc-static-preact-')||
          name.startsWith('loc-public-')).map(name=>caches.delete(name)));
      }
      if(old.length&&navigator.serviceWorker.controller)
        console.info('[loc-sw] Former LOC Service Worker unregistered; reopen this page once to release its old controller.');
    })().catch(()=>{});
  },[]);
  // Administrative Scope metadata updates refresh the shared ZenStack
  // query state consumed by the shell, runtime, and Guest feature pages.
  useEffect(()=>{
    const refresh=()=>queryClient.invalidateQueries({queryKey:['app-bootstrap']});
    const refreshLocal=()=>queryClient.invalidateQueries({predicate:query=>Array.isArray(query.queryKey)&&query.queryKey.some(part=>part==='local'||(typeof part==='string'&&part.startsWith('silver.local_')))});
    window.addEventListener('loc-public-scope-metadata-changed',refresh);
    window.addEventListener('loc-local-data-changed',refreshLocal);
    return()=>{
      window.removeEventListener('loc-public-scope-metadata-changed',refresh);
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
  const editDock=useEditDock();
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
  const pageName=currentFeature||'index';
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
  // Routes and Scope membership are published metadata; labels and page copy
  // are mutable SQL data mirrored in the private R2 bucket.
  const registryScopes=PUBLISHED_SITE_BOOTSTRAP.registry||[];
  const pageCopyByScope=new Map(publicPageCopy.map(row=>[String(row.scope_id||''),row]));
  const navDisplayNames=Object.fromEntries(publicPageCopy.map(row=>[
    String(row.scope_id||''),String(row.title_tw||row.display_name||'').trim()
  ]).filter(([,label])=>label));
  useEffect(()=>setNative(Capacitor.isNativePlatform()),[]);
  const currentScope=scope||getScope(scopeId);
  const [activeLocale,setActiveLocale]=useState('zh-Hant');
  const [localePreferenceReady,setLocalePreferenceReady]=useState(false);
  useEffect(()=>{
    try{setActiveLocale(normalizeUiLocale(window.localStorage.getItem('loc-interface-locale-v1')));}
    catch{}
    setLocalePreferenceReady(true);
  },[]);
  const localeReady=useLoadedUiLocale(activeLocale,pathname,localePreferenceReady);
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
  // All Group/Scope/User destinations share the published routing table.
  // The route builder preserves native index.html and dynamic scopeid paths.
  const managementHref=(level,key)=>managementRouteHref(
    level,key,navScopeId,{native,navigate:navigationHref}
  );
  const editingDockVisible=Boolean(editDock?.active&&editDock.scopeId===navScopeId);
  const locAdminEdit=navScopeId==='loc';
  const editSegments=String(pathname||'').split('/').filter(Boolean);
  const featureEditReturn=editSegments.includes('culture')?'culture'
    :editSegments.includes('statics')&&(editSegments.includes('keywords')||editSegments.includes('manage'))?'statics'
    :editSegments.includes('search')&&(editSegments.includes('manage')||editSegments.includes('admin'))?'search'
    :editSegments.includes('trace')&&editSegments.includes('manage')?'trace'
    :null;
  const isFeatureEditMode=Boolean(editingDockVisible&&featureEditReturn);
  // Four fixed destinations, followed by Save/Cancel. Group management lives
  // at /manage; Scope space management lives at /trace/manage.
  // Only the Group article link requests edit=1 explicitly.
  const editDestinations=locAdminEdit?[
    ...(editDock?.canManageGlobal?[{id:'system',icon:'settings',label:translateUiField(activeLocale,'系統管理'),
      href:managementHref('group','system')}]:[]),
    {id:'members',icon:'culture',label:translateUiField(activeLocale,'群組管理'),
      href:managementHref('group','members')},
    {id:'keywords',icon:'keywords',label:translateUiField(activeLocale,'關鍵詞'),
      href:managementHref('group','keywords')},
    {id:'suggestions',icon:'search',label:translateUiField(activeLocale,'文章管理'),
      href:managementHref('group','articles')}
  ]:[
    {id:'time',icon:'culture',label:translateUiField(activeLocale,'時間定錨'),
      href:editScopeAvailable?managementHref('scope','time'):''},
    {id:'manage',icon:'trace',label:navScopeId==='local'?'管理':translateUiField(activeLocale,'空間定錨'),
      href:navScopeId==='local'?navigationHref('local','manage',native)
        :managementHref('scope','spatial')},
    {id:'keywords',icon:'keywords',label:translateUiField(activeLocale,'關鍵詞'),
      href:editScopeAvailable&&navScopeId!=='local'?managementHref('scope','keywords'):''},
    {id:'suggestions',icon:'search',label:translateUiField(activeLocale,'文章管理'),
      href:navScopeId==='local'?navigationHref('local','search',native)
        :managementHref('scope','articles')}
  ];
  const editTabs=[
    {id:'save',icon:'save',label:translateUiField(activeLocale,'儲存'),action:'save'},
    ...editDestinations,
    {id:'cancel',icon:'cancel',label:translateUiField(activeLocale,'取消'),action:'cancel'}
  ];
  const featureTabs=PRIMARY_NAV_ORDER.map(id=>{
    if(id==='home')return {id,icon:'home',label:translateUiField(activeLocale,'首頁'),
      href:localNavigation?navigationHref('local','',native):
        navigationHref(navScopeId,'',native)};
    if(id==='settings')return {id,icon:'settings',label:copy.common.settings||'設定',
      href:native?'/local/settings/index.html?scopeid='+encodeURIComponent(navScopeId)
        :'/settings/?scopeid='+encodeURIComponent(navScopeId)};
    const feature=FEATURES.find(item=>item.id===id);
    return {id,icon:id,label:copy.features?.[id]?.title||feature.label,
      href:managementRouteHref('user',id,localNavigation?'local':navScopeId,
        {native,navigate:navigationHref})};
  });

  // The fixed frame must never wait for a locale HTTP request or unrelated
  // Bootstrap state. Page copy still updates when its JSON becomes available.
  // A failed/hanging locale request leaves the bundled Chinese shell usable.
  return <UiLocaleProvider locale={activeLocale} pathname={pathname}>
    <ScopePageCopy scopeId={localNavigation?'local':scopeId}
      display_name={localNavigation?'本機銀河':configRow?.display_name||registryRow?.display_name}
      pageCopy={pageCopyByScope.get(localNavigation?'local':scopeId)||null}/>
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
      {localCoreActive&&!localWorkspace?<main className="scope-main"><p className="scope-status" role="status">正在切換手機本機資料…</p></main>:children}
    </PageResourceBoundary>
    <motion.div layoutRoot className="scope-feature-dock scope-floating-edit-buttons" role="toolbar"
      aria-label={translateUiField(activeLocale,editingDockVisible?'編輯功能選單':'Scope 功能選單')}
      data-scope={localNavigation?'local':scopeId} data-local-core={localCoreActive?'active':undefined} data-action-count={editingDockVisible?editTabs.length:6}>
      {editingDockVisible?editTabs.map(tab=>{
        const selected=Boolean(tab.href&&targetIsCurrent(tab.href,host,pathname));
        const isSave=tab.action==='save';
        const disabled=tab.action?editDock.busy&&tab.action!=='cancel':!tab.href;
        const effectName=tab.id==='manage'?'spatial':
          tab.id==='time'||tab.id==='members'?tab.id:tab.icon;
        return <motion.button type="button" key={tab.id}
          className={tab.action?'scope-edit-dock-action':undefined}
          disabled={disabled}
          aria-current={selected?'page':undefined}
          whileTap={disabled?undefined:'dockPressed'}
          onClick={()=>{
            if(isSave){void editDock.save({exitOnSuccess:isScopeHomepage});return;}
            if(tab.action==='cancel'){
              editDock.discard(navigationHref(navScopeId,isFeatureEditMode?featureEditReturn:'',native),
                {confirmOnlyWhenDirty:isFeatureEditMode});return;
            }
            if(tab.href){
              setDockActivation(prev=>({id:tab.id,count:prev.count+1}));
              editDock.switchTo(tab.href);
            }
          }}>
          <DockMotionIcon name={tab.icon} effectName={effectName} management
            active={isSave?editDock.saveRevision>0:selected}
            activation={isSave?editDock.saveRevision:dockActivation.id===tab.id?dockActivation.count:0}/>
          <span>{tab.label}</span>
        </motion.button>;
      })
      :<LayoutGroup id={'loc-six-key-dock-'+(localNavigation?'local':scopeId)}>
        {featureTabs.map((tab,index)=>{
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
            {showRainbowPreview&&!localCoreActive?<RainbowDockFrame index={index}/>:null}
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
        {(!isSettings||runtime.locationMounted)?<ThemeSelect scopeId={themeScopeId} scopeMeta={themeScopeId===scopeId?currentScope:getScope(themeScopeId)} copy={copy} defaultThemeIdOverride={gameThemeDefault} pageName={pageName}/>:null}
        <LanguageSelect
          locale={activeLocale}
          copy={copy}
          onChange={locale=>{
            try{window.localStorage.setItem('loc-interface-locale-v1',normalizeUiLocale(locale));}catch{}
            window.location.reload();
          }}
        />
        <small className="scope-footer-date-basis" aria-label={({'zh-Hant':'日期基準','zh-Hans':'日期基准',en:'Date basis',ja:'日付基準'}[activeLocale]||'日期基準')+'：Asia/Taipei (UTC+08:00)'}>
          {({'zh-Hant':'日期基準','zh-Hans':'日期基准',en:'Date basis',ja:'日付基準'}[activeLocale]||'日期基準')+'：Asia/Taipei (UTC+08:00)'}
        </small>
      </div>
      <FlashMessage/>
    </footer>
  </UiLocaleProvider>;
}
