import React,{lazy,Suspense,useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {createPortal} from 'react-dom';
import {UiLocaleProvider,useLoadedUiLocale} from '../../i18n/ui-locale.jsx';
import {EditDockProvider,useEditDock} from '../../modular/edit-dock.jsx';

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
    for(const link of links)link.hidden=Boolean(dock?.active);
    return ()=>{for(const link of links)link.hidden=false;};
  },[surface,dock?.active]);
  if(!dock?.active||!surface)return null;
  const base=scopeId==='loc'?'/':'/'+scopeId+'/';
  const options=[
    ['時間定錨',base+'culture/manage/'],
    ['關鍵詞',base+'statics/manage/'],
    ['空間定錨',base+'trace/manage/'],
    ['文章管理',base+'search/manage/']
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
function Interactive(){
  useLoadedUiLocale('zh-Hant',window.location.pathname);
  return <UiLocaleProvider locale="zh-Hant" pathname={window.location.pathname}>
    <EditDockProvider scopeId={scopeId}>
      <Suspense fallback={<main className="scope-main" role="status">正在載入頁面內容…</main>}>
        <Feature/>
      </Suspense>
      <EditorControls/>
    </EditDockProvider>
  </UiLocaleProvider>;
}
if(node&&component!=='outbound')
  createRoot(node).render(<Interactive/>);
