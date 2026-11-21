import React,{lazy,Suspense} from 'react';
import {createRoot} from 'react-dom/client';
import AppShell from '../../AppShell.jsx';
import LocApp from '../LocApp.jsx';

// The filesystem publishes real HTML documents. No browser routing table:
// the URL only selects the already-existing feature component when required.
const GlobalSettings=lazy(()=>import('../preferences/GlobalSettings.jsx'));
const FeatureSettings=lazy(()=>import('../preferences/FeatureSettingsPage.jsx'));
const ExtensionBridge=lazy(()=>import('../../extension/bridge/GalaxyLinkBridge.jsx'));
const PhoneWorkspace=lazy(()=>import('../local/Workspace.jsx'));
const AuthorHome=lazy(()=>import('../views/AuthorHomeView.jsx'));
const OutboundLink=lazy(()=>import('../views/LrsWebRedirect.jsx'));
const ManagementRedirect=lazy(()=>import('../views/LegacyManagementRedirect.jsx'));

function locationParts(){
  const path=window.location.pathname.replace(/\/index\.html$/i,'/');
  return path.split('/').filter(Boolean);
}
function currentPage(){
  const parts=locationParts();
  if(parts[0]==='extension'&&parts[1]==='bridge')
    return <ExtensionBridge/>;
  if(parts[0]==='my-phone')return <PhoneWorkspace view="home"/>;

  const group=['lo3rwang','lrunes','local','scope-shell'].includes(parts[0])
    ?parts.shift():'';
  const scope=group&&group!=='scope-shell'?group:null;
  const route=parts.join('/');

  if(route==='settings'||route==='settings/features')
    return route.endsWith('features')?<FeatureSettings/>:<GlobalSettings/>;
  if(route==='work'&&scope==='lo3rwang')
    return <AuthorHome section="work"/>;

  // Links leave LOC. The destination owns its own runtime and pages.
  if(['card','daily','game'].includes(parts[0]))
    return <OutboundLink path={'/'+parts.join('/')+'/'} />;

  // Retained published URLs are served as HTML; an iOS build can still
  // open the corresponding editor without a browser redirect.
  if(route==='manage/search'||route==='statics/keywords'&&scope!=='local'){
    const to=route==='manage/search'?'search/manage':'statics/manage';
    const prefix=group?group+'/':'';
    return <ManagementRedirect target={'/'+prefix+to+'/'}
      view={route==='manage/search'?'searchManage':'keywords'} scope={scope}/>;
  }

  let view='home',section=null,forced=scope;
  if(route==='admin')view='admin';
  else if(route==='culture')view='culture';
  else if(route==='culture/manage'){
    view=group&&group!=='local'?'culture':'sourceManage';
    if(!group)forced='loc';
  }else if(route==='statics')view='statics';
  else if(route==='statics/manage'){
    view=group?'keywords':'keywordManage';
    if(!group)forced='loc';
  }else if(route==='statics/keywords')view='keywords';
  else if(route==='search')view='search';
  else if(route==='search/manage'){
    view='searchManage';
    if(!group)forced='loc';
  }else if(route==='trace')view='trace';
  else if(route==='trace/manage'){
    view='manage';
    if(group)section='traceMap';
    else forced='loc';
  }else if(route==='manage')view=scope==='local'?'setting':'manage';
  else if(route==='setting')view='setting';

  return <LocApp forcedView={view} forcedScope={forced} forcedSection={section}/>;
}
const root=document.getElementById('loc-root');
if(root)createRoot(root).render(
  <AppShell><Suspense fallback={<main className="scope-main" role="status">正在載入頁面內容…</main>}>
    {currentPage()}
  </Suspense></AppShell>
);
