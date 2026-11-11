'use client';

import {useEffect,useLayoutEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import dynamic from 'next/dynamic';
import {Capacitor} from '@capacitor/core';
import {QueryClient,QueryClientProvider,useQueryClient} from '@tanstack/react-query';
import {translateUiField,UI_COPY,UI_LOCALE_OPTIONS,normalizeUiLocale,uiCopy,registerDefaultSection,isSectionLoaded,loadSection} from './i18n/ui-copy';
import {UiLocaleProvider,useLoadedUiLocale,useUiLocale,useUiSection} from './i18n/ui-locale';
import FieldText from './i18n/FieldText';
import fieldsZh from './i18n/sections/fields.zh_tw.js';
import dataSourceStatusZh from './i18n/sections/uiExtra.dataSourceStatus.zh_tw.js';
registerDefaultSection('fields',fieldsZh);
registerDefaultSection('uiExtra.dataSourceStatus',dataSourceStatusZh);
import {FEATURES,SCOPES,featureIdForPath,getScope} from './modular/scope-registry';
import {applyTheme,themeSignature,THEME_SLOTS} from './modular/theme-registry';
import {mergeThemeSlot} from './loc/theme-data';
import {useScopeRuntime} from './modular/use-scope-runtime';
import {faviconForScope} from './site-favicons';
import {appBootstrapPageCopy,useAppBootstrap} from './loc/app-bootstrap';
import {getDbSourceStatus,subscribeDbSourceStatus} from './loc/db-source-status.mjs';
import {readHomeEditorAccess} from './loc/home-edit-access.mjs';
import {useNavigationPreferences} from './loc/use-navigation-preferences';
import {NavigationPreferences} from './modular/navigation-preferences';
import {navigationHref} from './modular/scope-registry.js';
import {recoverChunkOnce} from './loc/chunk-recovery.mjs';
import BottomNavIcon from './modular/BottomNavIcon';
import {EditDockProvider,useEditDock} from './modular/edit-dock';
// Only individual Scope homepages download the opt-in management entry.
const ScopeHomeEditEntry=dynamic(()=>import('./loc/ScopeHomeEditEntry'),{loading:()=>null});
const HomeEditModeRestore=dynamic(()=>import('./loc/HomeEditModeRestore'),{loading:()=>null});
import ScrollableScopeNav from './modular/ScrollableScopeNav';
import ScopeLink,{isManagementHref} from './modular/ScopeLink';

const {account:accountNavigation,device:deviceNavigation}=NavigationPreferences;

const SYSTEM_THEME_ID='system-default';
const DAY_THEME_ID='theme-7';
const NIGHT_THEME_ID='theme-1';
const THEME_TIME_ZONE='Asia/Taipei';
const NAV_SCOPES=Object.values(SCOPES)
  .filter(scope=>scope.nav)
  .sort((a,b)=>String(a.nav.position).localeCompare(String(b.nav.position))||Number(a.nav.order||0)-Number(b.nav.order||0));

import FlashMessage from './loc/FlashMessage';

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

function ThemeSelect({scopeId,scopeMeta=null,copy=UI_COPY,defaultThemeIdOverride='',pageName='index'}){
  const scope=scopeMeta||getScope(String(scopeId||'').trim());
  // Scope defaults are owned by the Scope config table; the game route alone
  // has its own purpose-built temporary default, never persisted to the DB.
  const fixedDefaultThemeId=String(defaultThemeIdOverride||'').trim();
  // Shares the ONE bootstrap request other shell parts already make for this
  // page: nothing here issues a second round trip for config or Themes.
  const bootstrap=useAppBootstrap(scopeId,pageName);
  const configEnabled=!fixedDefaultThemeId&&scope.id!=='loc'&&!scope.aggregateChildren&&scope.id!=='admin';
  const configuredTheme=configEnabled?String(bootstrap.data?.config?.theme||'').trim():'';
  const configuredDefaultThemeId=configuredTheme===SYSTEM_THEME_ID?'':configuredTheme;
  const [selection,setSelection]=useState(()=>({scopeId,themeId:SYSTEM_THEME_ID}));
  const [now,setNow]=useState(()=>new Date());
  // Applying a saved Scope default must also clear any temporary footer choice.
  // Otherwise the local preview can mask a successful database update.
  useEffect(()=>{
    const onSaved=event=>{
      if(event?.detail?.scopeId===scopeId)setSelection({scopeId,themeId:SYSTEM_THEME_ID});
    };
    window.addEventListener('loc-scope-theme-saved',onSaved);
    return()=>window.removeEventListener('loc-scope-theme-saved',onSaved);
  },[scopeId]);
  const selectedThemeId=selection.scopeId===scopeId?selection.themeId:SYSTEM_THEME_ID;
  const systemDefaultThemeId=fixedDefaultThemeId||configuredDefaultThemeId||automaticThemeId(now);
  const effectiveThemeId=selectedThemeId===SYSTEM_THEME_ID?systemDefaultThemeId:selectedThemeId;
  const themeRows=Array.isArray(bootstrap.data?.themes)?bootstrap.data.themes:[];
  const override=themeRows.find(row=>row.theme_id===effectiveThemeId)||null;
  const slot=useMemo(
    ()=>mergeThemeSlot(effectiveThemeId,override),
    [effectiveThemeId,override]
  );
  const themeChoices=themeRows.length
    ?themeRows.map(row=>({id:row.theme_id,label:row.theme_name||row.theme_id}))
    :THEME_SLOTS.map(item=>({id:item.id,label:item.label}));

  useEffect(()=>{
    // Show the page as soon as it hydrates, in the built-in day/night palette, and
    // never wait on the network. The DB palette and the Scope's configured theme
    // are applied the moment they arrive (slot changes). No palette is stored.
    const root=document.documentElement;
    if(root.dataset.themeSignature===themeSignature(slot)){
      delete root.dataset.themeBootstrap;
      return;
    }
    applyTheme(slot);
  },[slot,scopeId,effectiveThemeId]);

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
    setSelection({scopeId,themeId:SYSTEM_THEME_ID});
  },[scopeId]);

  return <label className="scope-theme-control">
    <span>{copy.common.theme}</span>
    <select value={selectedThemeId} onChange={event=>setSelection({scopeId,themeId:event.target.value})} aria-label={copy.common.theme}>
      <option value={SYSTEM_THEME_ID}>{copy.common.systemTheme}</option>
      {themeChoices.map(item=><option value={item.id} key={item.id}>{item.label}</option>)}
    </select>
  </label>;
}
function ScopePageCopy({scopeId,display_name,pageName='index'}){
  const enabled=Boolean(scopeId)&&scopeId!=='loc'&&scopeId!=='admin';
  const bootstrap=useAppBootstrap(scopeId,pageName);
  const pageCopy=enabled?appBootstrapPageCopy(bootstrap.data,scopeId):null;
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

// The provider must sit ABOVE the component that calls useAppBootstrap, so it
// lives in this thin wrapper (a hook cannot read a provider rendered by itself).
export default function AppShell({children}){
  const [client]=useState(()=>new QueryClient({
    defaultOptions:{queries:{
      staleTime:Infinity,refetchOnMount:false,refetchOnWindowFocus:false,
      refetchOnReconnect:false,refetchInterval:false,retry:false
    }}
  }));
  return <QueryClientProvider client={client}><EditDockProvider><AppShellInner>{children}</AppShellInner></EditDockProvider></QueryClientProvider>;
}

function AppShellInner({children}){
  const queryClient=useQueryClient();
  useEffect(()=>{
    // Retire the browser PWA Service Worker. This does not affect the
    // Cloudflare server Workers, public SQL APIs, or Capacitor native app.
    if(Capacitor.isNativePlatform()||!('serviceWorker' in navigator))return;
    const legacyScript='/sw.js';
    void navigator.serviceWorker.getRegistrations().then(registrations=>
      Promise.all(registrations.filter(reg=>{
        try{
          const scope=new URL(reg.scope);
          if(scope.origin!==location.origin)return false;
          return [reg.active,reg.waiting,reg.installing].some(worker=>{
            if(!worker?.scriptURL)return false;
            const script=new URL(worker.scriptURL);
            return script.origin===location.origin&&script.pathname===legacyScript;
          });
        }catch{return false;}
      }).map(reg=>reg.unregister()))
    ).catch(()=>{});
    if('caches' in window){
      void caches.keys().then(keys=>Promise.all(keys
        .filter(name=>name.startsWith('loc-public-'))
        .map(name=>caches.delete(name)))).catch(()=>{});
    }
  },[]);
  // Administrative Scope metadata updates refresh the shared ZenStack
  // query state consumed by the shell, runtime, and Guest feature pages.
  useEffect(()=>{
    const refresh=()=>queryClient.invalidateQueries({queryKey:['app-bootstrap'],refetchType:'none'});
    const refreshLocal=()=>queryClient.invalidateQueries({predicate:query=>Array.isArray(query.queryKey)&&query.queryKey.some(part=>part==='local'||(typeof part==='string'&&part.startsWith('silver.local_'))),refetchType:'none'});
    window.addEventListener('loc-public-scope-metadata-changed',refresh);
    window.addEventListener('loc-local-data-changed',refreshLocal);
    return()=>{
      window.removeEventListener('loc-public-scope-metadata-changed',refresh);
      window.removeEventListener('loc-local-data-changed',refreshLocal);
    };
  },[queryClient]);
  const {scopeId,scope,host,pathname,registryRow,configRow}=useScopeRuntime();
  const protectedEditorRoute=isManagementHref(pathname)||/^\/admin(?:\/|$)/i.test(String(pathname||''));
  const editDock=useEditDock();
  const [restoreHomeEdit,setRestoreHomeEdit]=useState(false);
  const [managementDenied,setManagementDenied]=useState(false);
  // Check the existing edit marker before paint. Protected management routes
  // verify via ManagementAccess instead; public pages never preflight roles.
  useLayoutEffect(()=>{
    try{
      const marker=readHomeEditorAccess(window.sessionStorage);
      setRestoreHomeEdit(!protectedEditorRoute&&marker?.scopeId===scopeId);
    }catch{setRestoreHomeEdit(false);}
  },[pathname,scopeId]);
  useEffect(()=>{
    if(editDock?.active&&restoreHomeEdit)setRestoreHomeEdit(false);
  },[editDock?.active,restoreHomeEdit]);
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
  const pageName=currentFeature||'index';
  const isSettings=['/settings','/settings/index.html','/local/setting','/local/setting/index.html','/local/settings','/local/settings/index.html'].includes(normalizePath(pathname));
  const [native,setNative]=useState(false);
  const [mobileFavorite,setMobileFavorite]=useState(true);
  const [nativeHomepage,setNativeHomepage]=useState('loc');
  const preferences=useNavigationPreferences();
  const [openFolderId,setOpenFolderId]=useState('');
  // Registry, NAV titles and Themes share one site snapshot across pages.
  // Scope config and page blocks load separately when first needed.
  // Components using the same (scopeId, pageName) ZenStack query key share one read.
  const bootstrap=useAppBootstrap(scopeId,pageName);
  const registryScopes=bootstrap.data?.registry||[];
  const registryLoaded=bootstrap.isSuccess||bootstrap.isError;
  const navDisplayNames=useMemo(()=>{
    const entries=(bootstrap.data?.page_copy||[])
      .map(row=>[String(row.scope_id||''),String(row.Title_TW||'').trim()])
      .filter(([,label])=>label);
    return Object.fromEntries(entries);
  },[bootstrap.data]);
  useEffect(()=>{
    const actual=Capacitor.isNativePlatform();
    setNative(actual);
    if(!actual)return;
    const sync=()=>{
      setMobileFavorite(deviceNavigation.mobileFavoriteEnabled(window.localStorage));
      setNativeHomepage(deviceNavigation.mobileHomepageChoice(window.localStorage));
    };
    sync();
    window.addEventListener('loc-device-navigation-changed',sync);
    return()=>window.removeEventListener('loc-device-navigation-changed',sync);
  },[]);
  const currentScope=scope||getScope(scopeId);
  // The Scope's locale travels inside the same bootstrap request as its config;
  // no separate fetch. A manual pick stands until the Scope changes.
  const [manualLocale,setManualLocale]=useState(null);
  const configLocaleEnabled=Boolean(scopeId)&&!currentScope.aggregateChildren&&scopeId!=='admin';
  const configuredLocale=configLocaleEnabled?normalizeUiLocale(bootstrap.data?.config?.locale):'zh-Hant';
  const activeLocale=manualLocale?.scopeId===scopeId?manualLocale.locale:configuredLocale;
  const localeReady=useLoadedUiLocale(activeLocale);
  const copy=useMemo(()=>uiCopy(activeLocale),[activeLocale,localeReady]);
  useEffect(()=>{document.documentElement.lang=activeLocale;},[activeLocale]);
  const [,refreshFieldLabels]=useState(0);
  useEffect(()=>{
    if(isSectionLoaded(activeLocale,'fields'))return undefined;
    let active=true;
    loadSection(activeLocale,'fields')
      .then(()=>{if(active)refreshFieldLabels(n=>n+1);})
      .catch(()=>{});
    return ()=>{active=false;};
  },[activeLocale]);
  const isMyPhone=native&&['/my-phone','/my-phone/index.html'].includes(normalizePath(pathname));
  // My Phone and every /local/* route use the same on-device SQLite Scope.
  const localWorkspace=native&&(isMyPhone||scopeId==='local');
  // /local/settings is the public Global Settings URL, not permission to
  // enter the device-only /local workspace from a Web browser.
  const navScopeId=!native&&currentScope.nativeOnly?'loc':localWorkspace?'local':currentScope.featureScope||scopeId;
  const gameThemeDefault=/(^|\/)game\/?$/.test(String(pathname||''))?'theme-4':'';

  useEffect(()=>{
    if(typeof document!=='undefined')document.documentElement.lang=activeLocale;
  },[activeLocale]);
  // Favorite targets are workspaces, not feature tabs. Unregistered/inactive
  // dynamic IDs are omitted; built-in fallback links work before DB hydration.
  const scopeNavLabel=item=>navDisplayNames[item.id]||item.nav.label;
  const registryMap=new Map(registryScopes.map(item=>[item.scope_id,item]));
  const layout=accountNavigation.folders.visibleFavoriteLayout(preferences.favorites,preferences.folders);
  const favoriteLinks=layout.direct.filter(id=>(!native||id!=='lrunes')&&(native||!getScope(id).nativeOnly)).map(id=>{
    const builtIn=NAV_SCOPES.find(item=>item.id===id);
    const active=registryMap.get(id);
    if(!builtIn&&!active)return null;
    return {id,label:builtIn?scopeNavLabel(builtIn):(navDisplayNames[id]||id)};
  }).filter(Boolean);
  // LunaRunes is the immutable core native App workspace, not a removable cloud favorite.
  if(native){
    favoriteLinks.unshift({id:'lrunes',label:'月之符文'});
    if(mobileFavorite)favoriteLinks.splice(1,0,{id:deviceNavigation.MOBILE_HOME_ID,label:translateUiField(activeLocale,'我的手機')});
  }
  const navLabel=id=>{
    const builtIn=NAV_SCOPES.find(item=>item.id===id);
    if(!builtIn&&!registryMap.has(id))return null;
    return builtIn?scopeNavLabel(builtIn):(navDisplayNames[id]||id);
  };
  const visibleFolders=layout.directories.map(folder=>({
    ...folder,links:folder.scopes.filter(id=>(!native||id!=='lrunes')&&(native||!getScope(id).nativeOnly)).map(id=>({id,label:navLabel(id)})).filter(item=>item.label)
  }));
  const openFolder=visibleFolders.find(folder=>folder.id===openFolderId)||null;
  const editScopeAvailable=navScopeId!=='loc'&&navScopeId!=='admin'&&!currentScope.aggregateChildren;
  // A Scope homepage may live at /, /scopeid/, /scope-shell/ or /scopeid/index.html.
  const homeParts=String(pathname||'/').split('/').filter(Boolean);
  if(homeParts.at(-1)==='index.html')homeParts.pop();
  const isScopeHomepage=homeParts.length===0||
    (homeParts.length===1&&(homeParts[0]===scopeId||homeParts[0]==='scope-shell'));
  // LOC's homepage has its own Admin-only editor; individual Scopes have
  // Scope-only editors. Both entries are visible to guests until clicked.
  const showHomeEditEntry=isScopeHomepage&&Boolean(scopeId)&&
    (scopeId==='loc'||(editScopeAvailable&&(!currentScope.nativeOnly||native)));
  // Keep existing query parameters (especially dynamic scopeid) on iOS and web.
  const editTabHref=(route,key,value)=>{
    const href=navigationHref(navScopeId,route,native);
    return href+(href.includes('?')?'&':'?')+
      encodeURIComponent(key)+'='+encodeURIComponent(value);
  };
  const editingDockVisible=Boolean(editDock?.active&&editDock.scopeId===navScopeId);
  const editDockPending=!editingDockVisible&&((restoreHomeEdit&&!editDock?.active)||
    (protectedEditorRoute&&!managementDenied));
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
      href:editTabHref('search/manage','section','media')+'&edit=1'}
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
    {id:'home',icon:localWorkspace?'phone':'home',label:localWorkspace?'使用說明':translateUiField(activeLocale,'首頁'),href:localWorkspace?deviceNavigation.mobileHomeHref(true):navigationHref(navScopeId,'',native)+(native&&navScopeId==='loc'?'?loc_direct=1':'')},
    ...['culture','statics','trace','search'].map(id=>{
      const feature=FEATURES.find(item=>item.id===id);
      return {id,icon:id==='trace'?(localWorkspace?'settings':'trace'):id,
        label:localWorkspace&&id==='trace'?'管理':(copy.features?.[id]?.title||feature.label),
        href:navigationHref(navScopeId,localWorkspace&&id==='trace'?'manage':feature.path,native)};
    }),
    {id:'settings',icon:'settings',label:copy.common.settings||'設定',href:native?'/local/settings/index.html':'/settings/'}
  ];

  useEffect(()=>{
    // A saved homepage changes the native App launch destination, not the
    // meaning of the "首頁" tab or the explicit LOC favorite link.
    if(!native||pathname!=='/'||preferences.loading||!registryLoaded)return;
    // Explicit LOC navigation remains possible even with a saved default.
    if(new URLSearchParams(window.location.search).has('loc_direct'))return;
    if(nativeHomepage===deviceNavigation.MOBILE_HOME_ID){
      window.location.replace(deviceNavigation.mobileHomeHref(true));return;
    }
    const target=nativeHomepage==='lrunes'?'lrunes':accountNavigation.homeScopeForAccount(nativeHomepage,preferences.account,
      ['loc',...NAV_SCOPES.map(item=>item.id),...registryScopes.map(item=>item.scope_id)]);
    if(target!=='loc')window.location.replace(navigationHref(target,'',true));
  },[native,nativeHomepage,pathname,preferences.loading,preferences.account,registryLoaded,registryScopes]);


  return <UiLocaleProvider locale={activeLocale}>
    <ScopePageCopy scopeId={scopeId} display_name={configRow?.display_name||registryRow?.display_name} pageName={pageName}/>
    <ScrollProgress/>
    <header className="scope-global" data-native={native?'ios':'web'}>
      <nav className="scope-nav" aria-label={copy.nav.aria}>
        <ScrollableScopeNav label={translateUiField(activeLocale,'常用空間')} resetKey={preferences.favorites.join(',')+'|'+mobileFavorite+'|'+native+'|'+visibleFolders.map(folder=>folder.id+':'+folder.label).join(',')}>
          {favoriteLinks.map(item=>{
            const href=item.id===deviceNavigation.MOBILE_HOME_ID?deviceNavigation.mobileHomeHref(native):navigationHref(item.id,'',native);
            return <NavTarget key={item.id} href={href} label={item.label} current={targetIsCurrent(href,host,pathname)} native={native}/>;
          })}
          {visibleFolders.map(folder=><button type="button" key={folder.id}
            className="scope-nav-folder" aria-expanded={openFolderId===folder.id}
            aria-controls="scope-nav-folder-contents" onClick={()=>setOpenFolderId(current=>current===folder.id?'':folder.id)}>
            {folder.label} <span aria-hidden="true">{openFolderId===folder.id?'▴':'▾'}</span>
          </button>)}
          {!favoriteLinks.length&&!visibleFolders.length?<ScopeLink href={native?'/local/settings/index.html':'/local/settings/'} native={native} className="scope-nav-empty"><FieldText text="到設定加入常用空間"/></ScopeLink>:null}
        </ScrollableScopeNav>
        <ScopeLink href={navigationHref('loc','',native)+(native?'?loc_direct=1':'')} native={native}
          className="scope-nav-loc-home" aria-current={scopeId==='loc'&&pathname==='/'?'page':undefined}>
          {copy.nav.home}
        </ScopeLink>
      </nav>
      {openFolder?<div id="scope-nav-folder-contents" className="scope-nav-subrow" aria-label={openFolder.label+' '+translateUiField(activeLocale,'目錄')}>
        <ScrollableScopeNav label={openFolder.label+' '+translateUiField(activeLocale,'目錄內容')} resetKey={openFolder.id+'|'+openFolder.links.map(item=>item.id).join(',')}>
          {openFolder.links.map(item=>{
            const href=navigationHref(item.id,'',native);
            return <NavTarget key={item.id} href={href} label={item.label} current={targetIsCurrent(href,host,pathname)} native={native}/>;
          })}
          {!openFolder.links.length?<span className="scope-nav-folder-empty"><FieldText text="目錄尚無入口"/></span>:null}
        </ScrollableScopeNav>
        <button type="button" className="scope-nav-close-folder" aria-label={translateUiField(activeLocale,'收合目錄')} onClick={()=>setOpenFolderId('')}>×</button>
      </div>:null}
    </header>
    {children}
    {restoreHomeEdit?<HomeEditModeRestore scopeId={scopeId}/>:null}
    <div className="scope-feature-dock scope-floating-edit-buttons" role="toolbar"
      aria-label={translateUiField(activeLocale,editingDockVisible||editDockPending?'編輯功能選單':'Scope 功能選單')}
      data-scope={localWorkspace?'local':scopeId} data-action-count={editingDockVisible?editTabs.length:6}>
      {editingDockVisible?editTabs.map(tab=>tab.action
        ?<button type="button" key={tab.id} className="scope-edit-dock-action"
          disabled={editDock.busy&&tab.action!=='cancel'}
          onClick={()=>tab.action==='save'
            ?editDock.save()
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
      :featureTabs.map(tab=><ScopeLink key={tab.id} href={tab.href} native={native}
        aria-current={tab.id==='settings'?isSettings?'page':undefined:
          !isSettings&&(tab.id==='home'?(localWorkspace?(isMyPhone||isScopeHomepage):isScopeHomepage):currentFeature===tab.id)?'page':undefined}>
        <BottomNavIcon name={tab.icon}/><span>{tab.label}</span>
      </ScopeLink>)}
      {editingDockVisible&&editDock.notice?<p className="scope-edit-dock-notice" role="status" aria-live="polite">{editDock.notice}</p>:null}
    </div>
    {showHomeEditEntry?<ScopeHomeEditEntry key={scopeId}/>:null}
    <footer className="scope-footer" data-scope={scopeId}>
      <div className="scope-footer-row">
        <a href="mailto:sopa2306@gmail.com">{copy.nav.contact}</a>
        <ThemeSelect scopeId={scopeId} scopeMeta={currentScope} copy={copy} defaultThemeIdOverride={gameThemeDefault} pageName={pageName}/>
        <LanguageSelect
          locale={activeLocale}
          copy={copy}
          onChange={locale=>setManualLocale({scopeId,locale:normalizeUiLocale(locale)})}
        />
        <small className="scope-footer-date-basis" aria-label={({'zh-Hant':'日期基準','zh-Hans':'日期基准',en:'Date basis',ja:'日付基準'}[activeLocale]||'日期基準')+'：Asia/Taipei (UTC+08:00)'}>
          {({'zh-Hant':'日期基準','zh-Hans':'日期基准',en:'Date basis',ja:'日付基準'}[activeLocale]||'日期基準')+'：Asia/Taipei (UTC+08:00)'}
        </small>
      </div>
      <DataSourceStatus local={localWorkspace}/>
      <FlashMessage/>
    </footer>
  </UiLocaleProvider>;
}
