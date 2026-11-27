'use client';
import FieldText from '../i18n/FieldText';
import UiText,{useUiText} from '../i18n/UiText';
import {useUiSection} from '../i18n/ui-locale';

import dynamic from 'next/dynamic';
import {recoverChunkOnce} from './ui/chunk-recovery.mjs';
import {Suspense,useEffect,useState} from 'react';
import {useRouter} from 'next/navigation';
import {Capacitor} from '@capacitor/core';
import {useScopeRuntime} from '../modular/use-scope-runtime';
import {getScope} from '../modular/routing/scope-registry';
import ManagementAccess from './management/ManagementAccess';
import ReturnLocHome from './ui/ReturnLocHome';
import {SCOPE_ROUTE_INDEX} from '../modular/routing/scope-route-index.js';
import {scopeFeatureEnabled} from './scope/scope-config-fields.mjs';
import {FeaturePage,ManagementHeroContext} from '../modular/ui';
// Tiny, CSS-only marks live only inside the already-existing loading slot.
// No assets, libraries, timers, layout shifts, or delayed navigation.
function FeatureLoadingMark({featureId}){
  if(featureId==='culture')return <svg className="loc-pending-mark loc-pending-culture"
    viewBox="0 0 88 42" fill="none" aria-hidden="true">
    <path d="M2 13C18 13 18 30 34 30S51 13 67 13H86"/>
    <path d="M2 24C18 24 18 8 34 8S51 25 67 25H86"/>
  </svg>;
  if(featureId==='statics')return <span className="loc-pending-mark loc-pending-statics" aria-hidden="true">
    <span>1 4 7</span><span>2 5 8</span><span>3 6 9</span>
  </span>;
  if(featureId==='trace')return <svg className="loc-pending-mark loc-pending-trace"
    viewBox="0 0 88 42" fill="none" aria-hidden="true">
    <path className="loc-pending-map" d="M8 9L30 5L54 11L80 6V33L56 37L32 31L8 36Z"/>
    <path className="loc-pending-map-fold" d="M30 5L32 31M54 11L56 37"/>
    <path className="loc-pending-pin" d="M45 11C38 11 38 20 45 28C52 20 52 11 45 11Z"/>
    <circle className="loc-pending-pin" cx="45" cy="18" r="2.2"/>
  </svg>;
  if(featureId==='search')return <svg className="loc-pending-mark loc-pending-search"
    viewBox="0 0 88 42" fill="none" aria-hidden="true">
    <g className="loc-pending-bulb">
      <path d="M20 17C20 9 33 9 33 17C33 22 29 23 29 27H24C24 23 20 22 20 17Z"/>
      <path d="M24 30H29M25 33H28"/>
    </g>
    <g className="loc-pending-lens">
      <circle cx="59" cy="18" r="10"/><path d="M66 25L77 36"/>
    </g>
  </svg>;
  return null;
}
// A dynamic feature's code can load later, but its Hero and content-frame
// placeholder render immediately. Only the body inside the frame is pending.
function FeatureFrameLoading({featureId}){
  return <FeaturePage featureId={featureId}>
    <section className="loc-card loc-feature-pending" aria-busy="true" role="status">
      <FeatureLoadingMark featureId={featureId}/>
      <span className="scope-status">正在載入頁面內容…</span>
    </section>
  </FeaturePage>;
}
const featureLoading=featureId=>()=> <FeatureFrameLoading featureId={featureId}/>;
function HomeFrameLoading(){
  const {scope}=useScopeRuntime();
  return <main className="scope-main"><section className="scope-page">
    <header className="loc-card scope-hero" aria-busy="true">
      <p className="loc-eyebrow">LOC</p>
      <h1>{scope?.label||'月典'}</h1>
    </header>
    <section className="loc-card loc-feature-pending" aria-busy="true" role="status">
      <span className="scope-status">正在載入首頁內容…</span>
    </section>
  </section></main>;
}
const loading=()=> <HomeFrameLoading/>;
// Scope feature switches gate public access even for an admin; identity never overrides publication.
// Heavy visualizations and editors should load only when their own page opens.
// Each home and group capability is independently loaded for its actual route.
const AboutView=dynamic(()=>import('./views/AboutView'),{loading});
const AuthorHomeView=dynamic(()=>import('./views/AuthorHomeView'),{loading});
const AdminHomeView=dynamic(()=>import('./views/AdminHomeView'),{loading:featureLoading('admin')});
const GenericScopeHomeView=dynamic(()=>import('./views/GenericScopeHomeView'),{loading});
const ScopeGroupOverview=dynamic(()=>import('./scope/ScopeGroupOverview'),{loading});
const Statistics=dynamic(()=>import('../modular/features/Statistics').catch(recoverChunkOnce),{loading:featureLoading('statics')});
const KeywordSettings=dynamic(()=>import('../modular/features/KeywordSettings'),{loading:featureLoading('statics')});
const Culture=dynamic(()=>import('../modular/features/Culture'),{loading:featureLoading('culture')});
const CulturePublic=dynamic(()=>import('./views/CulturePublicReader'),{loading:featureLoading('culture')});
const Search=dynamic(()=>import('../modular/features/Search').catch(recoverChunkOnce),{loading:featureLoading('search')});
const SearchManagement=dynamic(()=>import('./search/SearchManagement').catch(recoverChunkOnce),{loading:featureLoading('search')});
const Trace=dynamic(()=>import('../modular/features/Trace'),{loading:featureLoading('trace')});
const RunesHomeView=dynamic(()=>import('./views/LrsPortalView'),{loading});
const ManagementView=dynamic(()=>import('./scope/ScopeManagement').catch(recoverChunkOnce),{loading:featureLoading('manage')});
const SourceManagementView=dynamic(()=>import('./source/LocSourceManagement'),{loading:featureLoading('culture')});
const KeywordManagementView=dynamic(()=>import('./keywords/ui/LocKeywordManagementPage'),{loading:featureLoading('statics')});
const LocalSettingView=dynamic(()=>import('./views/LocalSettingView'),{loading:featureLoading('setting')});
const LocalScopeWorkspace=dynamic(()=>import('./local/Workspace'),{loading});

const VIEWS={
  admin:AdminHomeView,
  statics:Statistics,
  keywords:KeywordSettings,
  culture:Culture,
  search:Search,
  searchManage:SearchManagement,
  trace:Trace,
  manage:ManagementView,
  sourceManage:SourceManagementView,
  keywordManage:KeywordManagementView,
  setting:LocalSettingView
};
const HOME_VIEWS={loc:AboutView,lrunes:RunesHomeView,lo3rwang:AuthorHomeView,admin:AdminHomeView};
const FEATURE_FLAGS=Object.freeze({
  statics:'statistics_able',
  keywords:'statistics_able',
  culture:'culture_able',
  search:'search',
  trace:'trace'
});

function FeatureGate({scopeId,scopeMeta=null,view,children}){
  const flag=FEATURE_FLAGS[view]||'';
  const scope=scopeMeta||getScope(scopeId);
  const enabled=Boolean(flag)&&!scope.aggregateChildren&&scope.id!=='admin';
  // Public feature gates read the already-published Scope flags; waiting
  // for a config SQL request must not block the Hero or content.
  if(!enabled)return children;
  const config=SCOPE_ROUTE_INDEX.find(row=>row.scope_id===scopeId&&row.active!==false)?.config;
  if(!config||!scopeFeatureEnabled(config,flag))return <ReturnLocHome reason="feature"/>;
  return children;
}

export default function LocApp({forcedView='home',forcedSection=null,forcedScope=null}){
  useUiSection('uiExtra.feature');
  const t=useUiText();
  const runtime=useScopeRuntime();
  const scopeId=forcedScope||runtime.scopeId;
  const scopeMeta=forcedScope&&runtime.scopeId!==forcedScope?getScope(forcedScope):runtime.scope;
  const router=useRouter();
  const [nativeOnlyReady,setNativeOnlyReady]=useState(false);
  useEffect(()=>{
    if(!scopeMeta?.nativeOnly)return;
    if(Capacitor.isNativePlatform()&&Capacitor.getPlatform()==='ios'){
      setNativeOnlyReady(true);
      return;
    }
    // Public Global Settings remains available on Web; the private
    // /local/* feature pages do not. A bookmark must not bypass the menu.
    router.replace('/local/settings/');
  },[scopeMeta?.nativeOnly,router]);
  const publicCulture=forcedView==='culture'&&scopeId!=='loc'&&scopeId!=='lrunes'
    &&scopeId!=='local'&&forcedSection!=='timeManage';
  const ActiveView=publicCulture?CulturePublic:forcedView==='home'
    ?HOME_VIEWS[scopeId]||GenericScopeHomeView
    :VIEWS[forcedView]||AboutView;
  // LOC retains its bespoke aggregate pages. Every other DB Scope Group is
  // an overview/guide only: never query another Scope's Galaxy or Time here.
  const groupOverviewView=Boolean(scopeMeta?.aggregateChildren&&scopeId!=='loc'&&
    ['statics','culture'].includes(forcedView));

  if(scopeMeta?.nativeOnly&&!nativeOnlyReady){
    return <main className="scope-main"><section className="scope-page">
      <p className="scope-status" role="status">此本機資料工作區僅在 iOS App 提供。網頁版正在返回設定。</p>
    </section></main>;
  }
  // A local native page reads only the device Galaxy. Reuse the existing
  // website six-feature routes, but never mount cloud FeatureGate or SQL.
  if(scopeId==='local'&&forcedView!=='setting'){
    return <div className="loc-next-main" data-loc-scope="local" data-loc-view={forcedView}>
      <Suspense fallback={<div className="loc-loading">正在讀取本機 Galaxy…</div>}>
        <LocalScopeWorkspace view={forcedView}/>
      </Suspense>
    </div>;
  }
  if(!forcedScope&&runtime.dynamic&&!runtime.registryResolved){
    return <div className="loc-next-main" data-loc-scope={scopeId}><div className="loc-loading"><UiText id="uiExtra.feature.registryLoading"/></div></div>;
  }
  if(!forcedScope&&runtime.dynamic&&(runtime.registryError||!runtime.registryRow))return <ReturnLocHome/>;

  const managementRoute=['manage','searchManage','sourceManage','keywordManage','keywords'].includes(forcedView)||
    (forcedView==='culture'&&forcedSection==='timeManage');
  // Management is LOC Web business UI, not LOC Auth account administration.
// Group: system/group/keywords/articles; Scope: time/keywords/space/articles;
// Scope: time anchors/keywords/space anchors/articles; actual grants remain server-owned.
// This is the Group's Article Management, not System Admin. A user's
  // admin role grants access but must not change the destination/level.
  const managementLevel=scopeMeta?.aggregateChildren?'group':'scope';
  const managementFeature=forcedView==='sourceManage'||forcedView==='culture'?'culture'
    :forcedView==='keywordManage'||forcedView==='keywords'?'statics'
    :forcedView==='searchManage'?'search'
    :forcedView==='manage'&&(forcedSection==='traceMap'||scopeId==='loc')?'trace':'manage';
  const managementPage=<ActiveView section={forcedSection} scopeId={scopeId}
    scopeGroup={scopeMeta?.featureScope||scopeMeta?.registry?.parent_scope_id||
      (scopeMeta?.aggregateChildren?scopeId:null)}/>;
  return <ManagementHeroContext.Provider value={forcedSection==='timeManage'?'timeManage':forcedView}>
  <div className="loc-next-main" data-loc-scope={scopeId} data-loc-view={forcedView}
    role={forcedView==='home'&&['loc','lo3rwang','lrunes'].includes(scopeId)?'main':undefined}>
    <Suspense fallback={forcedView==='home'?<HomeFrameLoading/>:
      <FeatureFrameLoading featureId={managementRoute?managementFeature:forcedView}/>}>
      <FeatureGate scopeId={scopeId} scopeMeta={scopeMeta} view={forcedView}>
        {groupOverviewView?<FeaturePage featureId={forcedView}>
          <ScopeGroupOverview
            scopeId={scopeId}
            featureId={forcedView}
            title={scopeMeta.label+' · '+t({statics:'features.statics.title',culture:'features.culture.title'}[forcedView])}
            description={t('uiExtra.feature.groupGuide')}
          />
        </FeaturePage>:managementRoute?<ManagementAccess key={scopeId+':'+forcedView+':'+runtime.pathname}
          scopeId={scopeId} level={managementLevel} featureId={managementFeature}
          staticFrame={['manage','searchManage','sourceManage','keywordManage'].includes(forcedView)}
        >{managementPage}</ManagementAccess>:managementPage}
      </FeatureGate>
    </Suspense>
  </div></ManagementHeroContext.Provider>;
}
