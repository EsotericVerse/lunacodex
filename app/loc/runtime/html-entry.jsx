import React,{lazy,Suspense,useEffect,useState,useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import {createPortal} from 'react-dom';
import {UiLocaleProvider,useLoadedUiLocale} from '../../i18n/ui-locale.jsx';
import {EditDockProvider,useEditDock} from '../../modular/edit-dock.jsx';
import FlashMessage from '../notifications/FlashMessage.jsx';
import {getDbSourceStatus,subscribeDbSourceStatus} from '../providers/db-source-status.mjs';

// HTML already contains navigation, footer and the page's feature attributes.
// Nothing resolves a browser route or mounts a global React application shell.
const LocFeature=lazy(()=>import('../LocApp.jsx'));
const GlobalSettings=lazy(()=>import('../preferences/GlobalSettings.jsx'));
const FeatureSettings=lazy(()=>import('../preferences/FeatureSettingsPage.jsx'));
const ExtensionBridge=lazy(()=>import('../../extension/bridge/GalaxyLinkBridge.jsx'));
const PhoneWorkspace=lazy(()=>import('../local/Workspace.jsx'));
const AuthorHome=lazy(()=>import('../views/AuthorHomeView.jsx'));
const HomeEditEntry=lazy(()=>import('../blocks/ScopeHomeEditEntry.jsx'));

const node=document.getElementById('loc-interactive-root');
const {locComponent:component='loc',locView:view='home',locScope:publishedScope='loc',
  locSection:section=''}=document.body.dataset;
const scopeId=window.location.pathname.startsWith('/scope-shell/')
  ?new URLSearchParams(window.location.search).get('scopeid')||publishedScope
  :publishedScope;
const generic=window.location.pathname.startsWith('/scope-shell/');
if(generic&&/^[a-z][a-z0-9]{0,14}$/.test(scopeId)){
  const native=window.location.protocol==='capacitor:';
  const suffix='?scopeid='+encodeURIComponent(scopeId);
  for(const link of document.querySelectorAll('[data-loc-feature-link]')){
    const feature=link.dataset.locFeatureLink;
    link.href=feature==='settings'
      ?(native?'/local/settings/index.html':'/settings/')+suffix
      :(native?'/scope-shell/'+(feature==='home'?'':feature+'/')+'index.html'
        :'/scope-shell/'+(feature==='home'?'':feature+'/'))+suffix;
  }
}

function Feature(){
  if(component==='bridge')return <ExtensionBridge/>;
  if(component==='phone')return <PhoneWorkspace view="home"/>;
  if(component==='settings')return <GlobalSettings/>;
  if(component==='features')return <FeatureSettings/>;
  if(component==='work')return <AuthorHome section="work"/>;
  return <>
    <LocFeature forcedView={view} forcedScope={scopeId==='loc'&&publishedScope==='loc'?null:scopeId}
      forcedSection={section||null}/>
    {view==='home'&&['loc','lo3rwang','lrunes'].includes(scopeId)
      ?<HomeEditEntry/>:null}
  </>;
}
function EditorControls(){
  const dock=useEditDock();
  const surface=document.querySelector('.scope-feature-dock');
  useEffect(()=>{
    if(!surface)return undefined;
    const links=[...surface.children].filter(item=>item.tagName==='A');
    for(const link of links)link.style.display=dock?.active?'none':'';
    return ()=>{for(const link of links)link.style.display='';};
  },[surface,dock?.active]);
  if(!dock?.active||!surface)return null;
  const base=generic?'/scope-shell/':scopeId==='loc'?'/':'/'+scopeId+'/';
  const suffix=generic?'?scopeid='+encodeURIComponent(scopeId):'';
  const options=[
    ['時間定錨',base+'culture/manage/'+suffix],
    ['關鍵詞',base+'statics/manage/'+suffix],
    ['空間定錨',base+'trace/manage/'+suffix],
    ['文章管理',base+'search/manage/'+suffix]
  ];
  return createPortal(<div className="scope-edit-dock-actions" role="group" aria-label="編輯功能">
    <button type="button" disabled={dock.busy} onClick={()=>dock.save({exitOnSuccess:view==='home'})}>儲存</button>
    {options.map(([label,href])=><button type="button" key={href}
      disabled={dock.busy} onClick={()=>dock.switchTo(href)}>{label}</button>)}
    <button type="button" disabled={dock.busy}
      onClick={()=>dock.discard(base)}>取消</button>
    {dock.notice?<p role="status">{dock.notice}</p>:null}
  </div>,surface);
}
function DataSourceStatus(){
  const current=useSyncExternalStore(subscribeDbSourceStatus,getDbSourceStatus,getDbSourceStatus);
  const slot=document.querySelector('[data-loc-data-source]');
  if(!slot)return null;
  const local=scopeId==='local';
  const text=local?'本機資料庫':current.unavailable?'資料來源目前無法讀取':
    current.degraded?'備用資料庫（'+current.backupLabel+'）':
      '主要資料庫（'+current.primaryLabel+'）';
  return createPortal(<details className="scope-data-source-details">
    <summary>資料來源狀態</summary>
    <div className="scope-data-source-values"><span role="status">{text}</span></div>
  </details>,slot);
}
function Interactive(){
  const [locale,setLocale]=useState(()=>window.__locHtmlLocale||'zh-Hant');
  useEffect(()=>{
    const onLocale=event=>setLocale(event.detail?.locale||'zh-Hant');
    window.addEventListener('loc-html-locale-changed',onLocale);
    return()=>window.removeEventListener('loc-html-locale-changed',onLocale);
  },[]);
  useLoadedUiLocale(locale,window.location.pathname);
  return <UiLocaleProvider locale={locale} pathname={window.location.pathname}>
    <EditDockProvider scopeId={scopeId}>
      <Suspense fallback={<main className="scope-main" role="status">正在載入頁面內容…</main>}>
        <Feature/>
      </Suspense>
      <EditorControls/>
      <FlashMessage/>
      <DataSourceStatus/>
    </EditDockProvider>
  </UiLocaleProvider>;
}
if(node&&component!=='outbound')
  createRoot(node).render(<Interactive/>);
