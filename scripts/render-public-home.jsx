// Single-source LOC static publishing: render the same homepage components used
// by the interactive editor. No copied block renderer, no browser hydration.
import React from 'react';
import {UI_LOCALE_OPTIONS} from '../app/i18n/ui-copy.js';
import {PUBLISHED_THEME_META} from '../app/modular/published-theme-meta.js';
import {PUBLISHED_SITE_BOOTSTRAP} from '../app/modular/published-site-bootstrap.js';
import JsonLd from '../app/seo/JsonLd.jsx';
import AuthorHomeView from '../app/loc/views/AuthorHomeView.jsx';
import {locWebSiteJsonLd,lunarunesWebSiteJsonLd,authorProfileJsonLd}
  from '../app/seo/metadata.js';
import {renderToStaticMarkup} from 'react-dom/server';
import BottomNavIcon from '../app/modular/BottomNavIcon.jsx';
import {SCOPES,FEATURES,navigationHref} from '../app/modular/routing/scope-registry.js';

const routes={loc:'/',lo3rwang:'/lo3rwang/',lrunes:'/lrunes/'};
const structuredHome={loc:locWebSiteJsonLd,lo3rwang:authorProfileJsonLd,
  lrunes:lunarunesWebSiteJsonLd};
const features=[{id:'home',label:'首頁',name:'home',route:''},
  ...['culture','statics','trace','search'].map(id=>{
    const meta=FEATURES.find(item=>item.id===id);
    return {id,label:meta?.label||id,name:id,route:meta?.path||id};
  }),{id:'settings',label:'設定',name:'settings',route:'settings'}];
const rootNav=Object.values(SCOPES).filter(scope=>scope.nav&&scope.id!=='loc')
  .sort((a,b)=>(a.nav.position==='before'?0:1)-(b.nav.position==='before'?0:1)||Number(a.nav.order||0)-Number(b.nav.order||0));
const knownNavIds=new Set(rootNav.map(scope=>scope.id));
const extraNav=(PUBLISHED_SITE_BOOTSTRAP.registry||[])
  .filter(row=>row.active!==false&&!knownNavIds.has(row.scope_id)&&
    !['loc','admin','local'].includes(row.scope_id))
  .map(row=>({id:row.scope_id,nav:{label:
    (PUBLISHED_SITE_BOOTSTRAP.page_copy||[]).find(copy=>copy.scope_id===row.scope_id)?.Title_TW||
    row.display_name||row.scope_id}}));

function PublicNavigation({scopeId,native=false}){
 return <header className="scope-global" data-native={native?"ios":"web"}>
   <nav className="scope-nav" aria-label="Scope 導覽">
     <div className="scope-nav-rail">
       <div className="scope-nav-viewport">
         <div className="scope-nav-items">
           {[...rootNav,...extraNav].map(scope=><a href={navigationHref(scope.id,'',native)} key={scope.id}
             aria-current={scope.id===scopeId?'page':undefined} data-loc-scope-link={scope.id}>
             {scope.nav.label||scope.id}
           </a>)}
           {native?<a data-loc-scope-link="local" href="/my-phone/index.html">我的手機</a>:null}
         </div>
       </div>
     </div>
     <a className="scope-nav-loc-home" data-loc-home-link href={navigationHref('loc','',native)} aria-current={scopeId==='loc'?'page':undefined}>首頁</a>
   </nav>
 </header>;
}
function PublicDock({scopeId,current='home',native=false}){
 return <div className="scope-feature-dock scope-floating-edit-buttons"
   role="toolbar" aria-label="Scope 功能選單" data-scope={scopeId} data-action-count={6}>
   {features.map(item=><a key={item.id}
     data-loc-feature-link={item.id}
     href={item.id==='settings'?(native?'/local/settings/index.html?scopeid='+scopeId:'/settings/?scopeid='+scopeId):navigationHref(scopeId,item.route,native)}
     aria-current={item.id===current?'page':undefined}>
     {item.id===current?<span className="scope-dock-active-pill" aria-hidden="true"/>:null}
     <span className="scope-dock-motion-icon"><BottomNavIcon name={item.name}/></span>
     <span data-loc-feature-label>{item.label}</span>
   </a>)}
 </div>;
}
function SiteFooter({scopeId,home=true,native=false}){
 return <>
   {home?<div className="scope-home-edit-entry">
     <button type="button" className="loc-button" data-loc-upgrade="edit">進入編輯模式</button>
   </div>:null}
   <footer className="scope-footer" data-scope={scopeId}>
     <div className="scope-footer-row">
       <a href="mailto:sopa2306@gmail.com">聯絡方式</a>
       {home?<button className="loc-button" type="button" data-loc-upgrade="interface">語系與主題設定</button>:<a href={native?"/local/settings/index.html?scopeid="+scopeId:"/settings/?scopeid="+scopeId}>語系與主題設定</a>}
       <label className="scope-theme-control"><span data-loc-label="theme">主題</span>
         <select aria-label="主題" data-loc-control="theme" defaultValue="system-default">
           <option value="system-default">系統預設</option>
           {PUBLISHED_THEME_META.map(([id,label])=><option key={id} value={id}>{label}</option>)}
         </select>
       </label>
       <label className="scope-theme-control scope-language-control"><span data-loc-label="language">語系</span>
         <select aria-label="語系" data-loc-control="locale" defaultValue="zh-Hant">
           {UI_LOCALE_OPTIONS.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}
         </select>
       </label>
       <small className="scope-footer-date-basis">日期基準：Asia/Taipei (UTC+08:00)</small>
     </div>
   </footer>
 </>;
}
function StaticSite({scopeId,native=false}){
 return <>
   <PublicNavigation scopeId={scopeId} native={native}/>
   <main id="loc-home-sql-slot" className="loc-next-main" data-loc-view="home" data-loc-scope={scopeId} role="status" aria-live="polite">
       <section className="loc-view loc-home">
         <header className="loc-home-hero loc-hero loc-home-block" aria-busy="true">
           <p className="scope-status">正在讀取首頁內容…</p>
         </header>
       </section>
   </main>
   <PublicDock scopeId={scopeId} native={native}/>
   <SiteFooter scopeId={scopeId} native={native}/>
   <JsonLd data={structuredHome[scopeId]?.()}/>
 </>;
}
// Static HTML already owns navigation and the six feature links.
// An interactive component mounts only inside the following content slot.
// One authored HTML canvas for each LOC feature page. Nav, Footer,
// floating six-key frame, outer main, and Hero frame never remount.
export function renderPublicFeatureFrame({scopeId='loc',title='LOC 月典',link='',feature='home',
  work=false,native=false,component='loc',view=feature}={}){
 const featureCanvas=['loc','settings','features'].includes(component)&&!work;
 return renderToStaticMarkup(<>
   <PublicNavigation scopeId={scopeId} native={native}/>
   {featureCanvas?<div className="loc-next-main" data-loc-view={view} data-loc-scope={scopeId}>
     <main className="scope-main" id="loc-feature-main">
       <section className="scope-page">
         <header id="loc-feature-hero-canvas" className="loc-card scope-hero scope-feature-hero" data-loc-canvas="hero">
           <h1 id="loc-static-feature-title" data-loc-frame-heading>{title}</h1>
         </header>
         <div id="loc-interactive-root" className="scope-content"
           data-feature-content="true" data-loc-canvas="content">
           <section className="loc-card loc-feature-pending" role="status" aria-busy="true">
             <span className="scope-status">正在載入頁面內容…</span>
           </section>
         </div>
       </section>
     </main>
   </div>:<div id="loc-interactive-root" data-feature-content="true">
     {work?<AuthorHomeView section="work"/>:<main className="scope-main"><section className="scope-page">
       <header className="loc-card scope-hero"><h1 data-loc-frame-heading>{title}</h1></header>
       {link?<p><a href={link}>前往 LunaRunes</a></p>:null}
     </section></main>}
   </div>}
   <PublicDock scopeId={scopeId} current={feature} native={native}/>
   <SiteFooter scopeId={scopeId} home={false} native={native}/>
 </>);
}
function activateOnDemand(entry,scopeId){
 // A single event bridge, not another app or router. In particular there is
 // no automatic import of Preact while reading published pages.
 return '<script id="loc-static-upgrade">'+[
  '(()=>{const root=document.getElementById("loc-root");let busy=false;',
  'document.addEventListener("click",async event=>{',
  'const target=event.target.closest("[data-loc-upgrade]");',
  'if(!target||busy)return;event.preventDefault();busy=true;',
  'const edit=target.dataset.locUpgrade==="edit";',
  'if(target.dataset.locUpgrade==="interface"){try{const mod=await import("/_loc/routes/public-preferences.js");',
  'const panel=document.createElement("div");panel.className="loc-static-preferences-mount";',
  'target.after(panel);target.hidden=true;',
  'mod.mountPublicPreferences(panel,{scopeId:'+JSON.stringify(scopeId)+',onOpenFull:()=>{',
  'panel.remove();target.hidden=false;target.dataset.locUpgrade="full";target.click();',
  'target.dataset.locUpgrade="interface";},onClosed:()=>{panel.remove();target.hidden=false;}});',
  '}catch(error){console.error("LOC Preact preferences failed",error);}',
  'busy=false;return;}',
  'const main=root.querySelector(".loc-next-main");if(!main){busy=false;return;}',
  'window.__locHomeUnmount?.();main.replaceChildren();',
  'main.id="loc-interactive-root";main.removeAttribute("role");main.removeAttribute("aria-live");',
  'const replacement=main;target.disabled=true;target.hidden=true;',
  'const observer=new MutationObserver(()=>{if(!edit)return;',
  'const next=replacement.querySelector(".scope-home-edit-entry button:not([disabled])");',
  'if(next){observer.disconnect();next.click();}});',
  'try{if(edit)observer.observe(replacement,{childList:true,subtree:true});',
  'await import('+JSON.stringify('/'+entry+'.js')+');',
  'setTimeout(()=>observer.disconnect(),12000);',
  '}catch(error){observer.disconnect();console.error("LOC feature load failed",error);busy=false;}',
  '});})();'
 ].join('')+'</script>';
}
export function renderPublicScopeHome({route,entry,native=false}){
 const scopeId=Object.keys(routes).find(key=>routes[key]===route);
 if(!scopeId)return null;
 return {
   scopeId,
   html:renderToStaticMarkup(<StaticSite scopeId={scopeId} native={native}/>),
   loader:'<script type="module" src="/_loc/routes/home.js"></script>'+
     activateOnDemand(entry,scopeId)
 };
}
