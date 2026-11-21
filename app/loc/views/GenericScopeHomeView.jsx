'use client';
import {lazy,Suspense} from 'react';

import {FeaturePage} from '../../modular/ui';
import UiText,{useUiText} from '../../i18n/UiText';
import {navigationHref} from '../../modular/routing/scope-registry.js';
import useNativeNavigation from '../../modular/use-native-navigation';
import {useScopeRuntime} from '../../modular/use-scope-runtime';
import ScopeLink from '../../modular/ScopeLink';
import {useUiSection} from '../../i18n/ui-locale';
// Only one of these mutually exclusive home capabilities is needed per Scope.
// Scope Groups must not load the editing implementation.
const LazyScopeGroupOverview=lazy(()=>import('../scope/ScopeGroupOverview'));
function ScopeGroupOverview(props){return <Suspense fallback={null}><LazyScopeGroupOverview {...props}/></Suspense>;}
const LazyScopeEditableBlocks=lazy(()=>import('../blocks/ScopeEditableBlocks'));
function ScopeEditableBlocks(props){return <Suspense fallback={null}><LazyScopeEditableBlocks {...props}/></Suspense>;}

export default function GenericScopeHomeView(){
  useUiSection('uiExtra.genericScope');
  const t=useUiText();
  const native=useNativeNavigation();
  const {scopeId,scope,registryRow}=useScopeRuntime();
  if(scope?.aggregateChildren){
    return <FeaturePage featureId="trace" subtitle={scope.label}>
      <ScopeGroupOverview
        scopeId={scopeId}
        featureId="trace"
        title={scope.label+' · Scope Group'}
        description={t('uiExtra.genericScope.guide')}
      />
    </FeaturePage>;
  }
  return <main className="scope-main"><section className="scope-page">
    <header className="loc-card scope-hero"><p className="loc-eyebrow">Scope</p><h1>{scope.label}</h1><p>{scopeId}</p></header>
    <section className="loc-card">
      <ScopeEditableBlocks scopeId={scopeId} page="index" explicitEditButton/>
      <p className="scope-status">{registryRow?.domain||registryRow?.directory||''}</p>
      <div className="scope-result-links">
        <ScopeLink href={navigationHref(scopeId,'search',native)} native={native}><UiText id="nav.search"/></ScopeLink>
        <ScopeLink href={navigationHref(scopeId,'statics',native)} native={native}><UiText id="features.statics.title"/></ScopeLink>
        <ScopeLink href={navigationHref(scopeId,'culture',native)} native={native}><UiText id="features.culture.title"/></ScopeLink>
        <ScopeLink href={navigationHref(scopeId,'trace',native)} native={native}><UiText id="features.trace.title"/></ScopeLink>
        <ScopeLink href={navigationHref(scopeId,scopeId==='loc'?'admin':'manage',native)} native={native}><UiText id="common.management"/></ScopeLink>
      </div>
    </section>
  </section></main>;
}
