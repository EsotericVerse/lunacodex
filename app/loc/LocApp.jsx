'use client';
import FieldText from '../i18n/FieldText';
import UiText,{useUiText} from '../i18n/UiText';
import {registerDefaultSection} from '../i18n/ui-copy';
import {useUiSection} from '../i18n/ui-locale';
import featureZh from '../i18n/sections/uiExtra.feature.zh_tw.js';
registerDefaultSection('uiExtra.feature',featureZh);

import dynamic from 'next/dynamic';
import {recoverChunkOnce} from './chunk-recovery.mjs';
import {Suspense,useEffect,useState} from 'react';
import {useRouter} from 'next/navigation';
import {Capacitor} from '@capacitor/core';
import {useScopeRuntime} from '../modular/use-scope-runtime';
import {getScope} from '../modular/scope-registry';
import ManagementAccess from './ManagementAccess';
import {useAsyncResource} from '../../zenstack/client-queries';
import {selectScopeConfig} from './scope-data';
import {scopeFeatureEnabled} from './scope-config-fields.mjs';
import {FeaturePage} from '../modular/ui';
const loading=()=> <div className="loc-loading"><UiText id="uiExtra.feature.moduleLoading"/></div>;
// Heavy visualizations and editors should load only when their own page opens.
// Each home and group capability is independently loaded for its actual route.
const AboutView=dynamic(()=>import('./views/AboutView'),{loading});
const AuthorHomeView=dynamic(()=>import('./views/AuthorHomeView'),{loading});
const AdminHomeView=dynamic(()=>import('./views/AdminHomeView'),{loading});
const GenericScopeHomeView=dynamic(()=>import('./views/GenericScopeHomeView'),{loading});
const ScopeGroupOverview=dynamic(()=>import('./ScopeGroupOverview'),{loading});
const Statistics=dynamic(()=>import('../modular/features/Statistics').catch(recoverChunkOnce),{
  // The Statistics chunk can be delayed after leaving Edit Dock. Keep the
  // public Hero visible during module loading instead of replacing it with
  // a blank-page placeholder. Recover stale deployment chunks once.
  loading:()=> <FeaturePage featureId="statics">
    <div className="loc-loading" role="status"><UiText id="uiExtra.feature.moduleLoading"/></div>
  </FeaturePage>
});
const KeywordSettings=dynamic(()=>import('../modular/features/KeywordSettings'),{loading});
const Culture=dynamic(()=>import('../modular/features/Culture'),{loading});
const CulturePublic=dynamic(()=>import('./views/CulturePublicReader'),{loading});
const Search=dynamic(()=>import('../modular/features/Search').catch(recoverChunkOnce),{loading});
const SearchManagement=dynamic(()=>import('./SearchManagement'),{loading});
const Trace=dynamic(()=>import('../modular/features/Trace'),{loading});
const RunesHomeView=dynamic(()=>import('../lrunes/RunesClient'),{loading});
const ManagementView=dynamic(()=>import('./ScopeManagement').catch(recoverChunkOnce),{loading});
const SourceManagementView=dynamic(()=>import('./LocSourceManagement'),{loading});
const KeywordManagementView=dynamic(()=>import('./LocKeywordManagementPage'),{loading});
const LocalSettingView=dynamic(()=>import('./views/LocalSettingView'),{loading});

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
// Same modules as the dynamic() declarations above, so the bundler reuses the same
// chunks. Only the view that is about to render is requested, and it is requested
// immediately, in parallel with the registry and FeatureGate config queries,
// instead of after they finish.
const VIEW_PRELOADERS={
  admin:()=>import('./views/AdminHomeView'),
  statics:()=>import('../modular/features/Statistics'),
  keywords:()=>import('../modular/features/KeywordSettings'),
  culture:()=>import('../modular/features/Culture'),
  search:()=>import('../modular/features/Search'),
  searchManage:()=>import('./SearchManagement'),
  trace:()=>import('../modular/features/Trace'),
  manage:()=>import('./ScopeManagement'),
  sourceManage:()=>import('./LocSourceManagement'),
  keywordManage:()=>import('./LocKeywordManagementPage'),
  setting:()=>import('./views/LocalSettingView')
};
const HOME_PRELOADERS={
  loc:()=>import('./views/AboutView'),
  lrunes:()=>import('../lrunes/RunesClient'),
  lo3rwang:()=>import('./views/AuthorHomeView'),
  admin:()=>import('./views/AdminHomeView')
};
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
  // Public feature gating reads only the Scope's four switches.
  // Do not fetch unrelated page Blocks or management permissions.
  const query=useAsyncResource(['public-feature-flags',scopeId],
    ()=>selectScopeConfig(scopeId),{enabled});
  if(!enabled)return children;
  if(query.isPending)return <FeaturePage featureId={view==='keywords'?'statics':view}>
    <section className="loc-card scope-feature-card scope-feature-loading">
      <div className="scope-feature-loading__controls" aria-hidden="true"><span/><span/><span/></div>
      <div className="scope-feature-loading__body" aria-hidden="true"><span/><span/><span/><span/></div>
      <p className="scope-status" role="status"><UiText id="uiExtra.feature.settingsLoading"/></p>
    </section>
  </FeaturePage>;
  if(query.error||!query.data)return <main className="scope-main"><section className="scope-page"><section className="loc-card"><p className="scope-status scope-error">Scope 設定無法讀取，暫時無法開啟功能。</p></section></section></main>;
  if(!scopeFeatureEnabled(query.data,flag))return <main className="scope-main"><section className="scope-page"><section className="loc-card"><p className="scope-status"><UiText id="uiExtra.feature.unpublished"/></p></section></section></main>;
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
    &&scopeId!=='local'&&!runtime.pathname.includes('/culture/manage');
  const ActiveView=publicCulture?CulturePublic:forcedView==='home'
    ?HOME_VIEWS[scopeId]||GenericScopeHomeView
    :VIEWS[forcedView]||AboutView;
  // LOC retains its bespoke aggregate pages. Every other DB Scope Group is
  // an overview/guide only: never query another Scope's Galaxy or Time here.
  const groupOverviewView=Boolean(scopeMeta?.aggregateChildren&&scopeId!=='loc'&&
    ['statics','culture'].includes(forcedView));

  useEffect(()=>{
    if(scopeMeta?.nativeOnly&&!nativeOnlyReady)return;
    const preload=publicCulture?()=>import('./views/CulturePublicReader'):
      forcedView==='home'
        ?HOME_PRELOADERS[scopeId]||(()=>import('./views/GenericScopeHomeView'))
        :VIEW_PRELOADERS[forcedView]||HOME_PRELOADERS.loc;
    preload().catch(()=>{});
    if(groupOverviewView)import('./ScopeGroupOverview').catch(()=>{});
  },[forcedView,scopeId,groupOverviewView,scopeMeta?.nativeOnly,nativeOnlyReady,publicCulture]);

  if(scopeMeta?.nativeOnly&&!nativeOnlyReady){
    return <main className="scope-main"><section className="scope-page">
      <p className="scope-status" role="status">此本機資料工作區僅在 iOS App 提供。網頁版正在返回設定。</p>
    </section></main>;
  }
  if(!forcedScope&&runtime.dynamic&&!runtime.registryResolved){
    return <div className="loc-next-main" data-loc-scope={scopeId}><div className="loc-loading"><UiText id="uiExtra.feature.registryLoading"/></div></div>;
  }
  if(!forcedScope&&runtime.dynamic&&(runtime.registryError||!runtime.registryRow)){
    return <main className="scope-main"><section className="scope-page"><section className="loc-card">
      <h1><UiText id="uiExtra.feature.registryUnavailable"/></h1>
      <p className="scope-status scope-error">{runtime.registryError||t('uiExtra.feature.registryNotFound')}</p>
    </section></section></main>;
  }

  const managementRoute=['manage','searchManage','sourceManage','keywordManage','keywords'].includes(forcedView)||
    (forcedView==='culture'&&runtime.pathname.includes('/culture/manage'));
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
  return <div className="loc-next-main" data-loc-scope={scopeId} data-loc-view={forcedView}
    role={forcedView==='home'&&['loc','lo3rwang'].includes(scopeId)?'main':undefined}>
    <Suspense fallback={<div className="loc-loading"><UiText id="uiExtra.feature.pageLoading"/></div>}>
      <FeatureGate scopeId={scopeId} scopeMeta={scopeMeta} view={forcedView}>
        {groupOverviewView?<FeaturePage featureId={forcedView}>
          <ScopeGroupOverview
            scopeId={scopeId}
            featureId={forcedView}
            title={scopeMeta.label+' · '+t({statics:'features.statics.title',culture:'features.culture.title'}[forcedView])}
            description={t('uiExtra.feature.groupGuide')}
          />
        </FeaturePage>:managementRoute?<ManagementAccess key={scopeId+':'+forcedView+':'+runtime.pathname}
          scopeId={scopeId} level={managementLevel} featureId={managementFeature}>{managementPage}</ManagementAccess>:managementPage}
      </FeatureGate>
    </Suspense>
  </div>;
}
