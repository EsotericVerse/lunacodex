import React,{lazy,Suspense,useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
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
  // Keep the six authored HTML links. Management only changes their labels,
  // destinations and handlers; never mount an overlay, menu or second dock.
  useEffect(()=>{
    if(!surface||!dock?.active)return undefined;
    const links=[...surface.children].filter(item=>
      item.tagName==='A'&&item.hasAttribute('data-loc-feature-link'));
    if(links.length!==6)return undefined;
    const native=window.location.protocol==='capacitor:';
    const base=generic?'/scope-shell/':scopeId==='loc'?'/':'/'+scopeId+'/';
    const destination=(segment='',params={})=>{
      const route=base+(segment?segment.split('/').filter(Boolean).join('/')+'/':'')+
        (native?'index.html':'');
      const url=new URL(route,window.location.origin);
      if(generic)url.searchParams.set('scopeid',scopeId);
      for(const [key,value] of Object.entries(params))url.searchParams.set(key,value);
      return url.pathname+url.search;
    };
    const isLocal=scopeId==='local',isLoc=scopeId==='loc';
    const options=isLoc?[
      ['系統管理',dock.canManageGlobal?(native?'/admin/index.html':'/admin/'):''],
      ['關鍵詞',destination('statics/manage',{edit:'1'})],
      ['人員作品管理',destination('culture/manage',{edit:'1'})],
      ['文章管理',destination('search/manage',{section:'publish',edit:'1'})]
    ]:isLocal?[
      ['時間定錨',''],['關鍵詞',''],
      ['管理',destination('manage')],['文章管理',destination('search')]
    ]:[
      ['時間定錨',destination('culture/manage',{edit:'1'})],
      ['關鍵詞',destination('statics/manage',{edit:'1'})],
      ['空間定錨',destination('manage',{section:'anchor',edit:'1'})],
      ['文章管理',destination('search/manage',{section:'publish',edit:'1'})]
    ];
    const paths=window.location.pathname.split('/').filter(Boolean);
    const back=['culture','statics','search','trace'].find(id=>paths.includes(id))||'';
    const actions=[
      {label:'儲存',href:'#',run:()=>dock.save({exitOnSuccess:view==='home'})},
      ...options.map(([label,href])=>({
        label,href:href||'#',unavailable:!href,run:()=>dock.switchTo(href)
      })),
      {label:'取消',href:'#',run:()=>dock.discard(destination(back))}
    ];
    const restoration=[];
    actions.forEach((action,index)=>{
      const link=links[index];
      const label=link.querySelector('[data-loc-feature-label]');
      const before={
        href:link.getAttribute('href'),label:label?.textContent||'',
        current:link.getAttribute('aria-current'),
        disabled:link.getAttribute('aria-disabled'),
        tabIndex:link.getAttribute('tabindex'),
        title:link.getAttribute('title')
      };
      const disabled=Boolean(dock.busy||action.unavailable);
      if(label)label.textContent=action.label;
      link.setAttribute('href',action.href);
      link.removeAttribute('aria-current');
      link.setAttribute('aria-disabled',String(disabled));
      link.setAttribute('title',action.label);
      if(disabled)link.setAttribute('tabindex','-1');
      else link.removeAttribute('tabindex');
      link.dataset.locMenuMode='management';
      const onClick=event=>{
        event.preventDefault();
        if(!disabled)void action.run();
      };
      link.addEventListener('click',onClick);
      restoration.push(()=>{
        link.removeEventListener('click',onClick);
        if(label)label.textContent=before.label;
        for(const [attr,value] of [
          ['href',before.href],['aria-current',before.current],
          ['aria-disabled',before.disabled],['tabindex',before.tabIndex],
          ['title',before.title]
        ]){if(value===null)link.removeAttribute(attr);else link.setAttribute(attr,value);}
        delete link.dataset.locMenuMode;
      });
    });
    let notice=null;
    if(dock.notice){
      notice=document.createElement('p');
      notice.className='scope-edit-dock-notice';
      notice.setAttribute('role','status');
      notice.textContent=dock.notice;
      surface.appendChild(notice);
    }
    return ()=>{for(const restore of restoration)restore();notice?.remove();};
  },[surface,dock?.active,dock?.busy,dock?.canManageGlobal,
    dock?.save,dock?.switchTo,dock?.discard,dock?.notice]);
  return null;
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
