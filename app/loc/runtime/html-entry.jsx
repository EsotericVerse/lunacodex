import React,{lazy,Suspense,useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {createPortal} from 'react-dom';
import {UiLocaleProvider,useLoadedUiLocale} from '../../i18n/ui-locale.jsx';
import {EditDockProvider,useEditDock} from '../../modular/edit-dock.jsx';
import FlashMessage from '../notifications/FlashMessage.jsx';
import {getLocalDeadline,hasExpiredLocalDeadline,stopLocalDeadline}
  from '../local/session.mjs';

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
  const native=window.location.protocol==='capacitor:';
  const base=generic?'/scope-shell/':scopeId==='loc'?'/':'/'+scopeId+'/';
  const destination=(segment='',params={})=>{
    const route=base+(segment?segment.split('/').filter(Boolean).join('/')+'/':'')+(native?'index.html':'');
    const url=new URL(route,window.location.origin);
    if(generic)url.searchParams.set('scopeid',scopeId);
    for(const [key,value] of Object.entries(params))url.searchParams.set(key,value);
    return url.pathname+url.search;
  };
  const isLocal=scopeId==='local';
  const isLoc=scopeId==='loc';
  const options=isLoc?[
    ...(dock.canManageGlobal?[['系統管理',native?'/admin/index.html':'/admin/']]:[]),
    ['關鍵詞',destination('statics/manage',{edit:'1'})],
    ['人員作品管理',destination('culture/manage',{edit:'1'})],
    ['文章管理',destination('search/manage',{section:'publish',edit:'1'})]
  ]:isLocal?[
    ['時間定錨',''],
    ['關鍵詞',''],
    ['管理',destination('manage')],
    ['文章管理',destination('search')]
  ]:[
    ['時間定錨',destination('culture/manage',{edit:'1'})],
    ['關鍵詞',destination('statics/manage',{edit:'1'})],
    ['空間定錨',destination('manage',{section:'anchor',edit:'1'})],
    ['文章管理',destination('search/manage',{section:'publish',edit:'1'})]
  ];
  const locationParts=window.location.pathname.split('/').filter(Boolean);
  const back=locationParts.includes('culture')?'culture':
    locationParts.includes('statics')?'statics':
    locationParts.includes('search')?'search':
    locationParts.includes('trace')?'trace':'';
  return createPortal(<div className="scope-edit-dock-actions" role="group" aria-label="編輯功能">
    <button className="scope-edit-dock-action" type="button" disabled={dock.busy}
      onClick={()=>dock.save({exitOnSuccess:view==='home'})}>儲存</button>
    {options.map(([label,href])=><button className="scope-edit-dock-action" type="button"
      key={label} disabled={dock.busy||!href} onClick={()=>dock.switchTo(href)}>{label}</button>)}
    <button className="scope-edit-dock-action" type="button" disabled={dock.busy}
      onClick={()=>dock.discard(destination(back))}>取消</button>
    {dock.notice?<p role="status" className="scope-edit-dock-notice">{dock.notice}</p>:null}
  </div>,surface);
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
      <Suspense fallback={document.getElementById('loc-feature-hero-canvas')
        ?<section className="loc-card loc-feature-pending" role="status" aria-busy="true">正在載入頁面內容…</section>
        :<main className="scope-main" role="status">正在載入頁面內容…</main>}>
        <Feature/>
      </Suspense>
      <EditorControls/>
      <FlashMessage/>
    </EditDockProvider>
  </UiLocaleProvider>;
}
function enforceDeviceLocalLease(){
  if(window.location.protocol!=='capacitor:')return false;
  const local=scopeId==='local'||component==='phone';
  if(hasExpiredLocalDeadline()&&local){
    stopLocalDeadline();
    window.location.replace('/index.html');
    return true;
  }
  if(getLocalDeadline()>0&&!local){
    window.location.replace('/local/index.html');
    return true;
  }
  return false;
}
if(node&&component!=='outbound'&&!enforceDeviceLocalLease()){
  if(window.location.protocol==='capacitor:'){
    window.addEventListener('focus',enforceDeviceLocalLease);
    window.addEventListener('pageshow',enforceDeviceLocalLease);
  }
  createRoot(node).render(<Interactive/>);
}
