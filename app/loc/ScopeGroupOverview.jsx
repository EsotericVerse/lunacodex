'use client';

import {useAsyncResource} from './use-async-resource';
import UiText,{useUiText} from '../i18n/UiText';
import {registerDefaultSection} from '../i18n/ui-copy';
import {useUiSection} from '../i18n/ui-locale';
import scopeGroupZh from '../i18n/sections/uiExtra.scopeGroup.zh_tw.js';
import {selectScopeGroupChildren} from './scope-data';
import {navigationHref} from '../modular/scope-registry.js';
import useNativeNavigation from '../modular/use-native-navigation';
import ScopeLink from '../modular/ScopeLink';
registerDefaultSection('uiExtra.scopeGroup',scopeGroupZh);

const FEATURE_PATH=Object.freeze({search:'search',statics:'statics',culture:'culture',trace:'trace'});
const FEATURE_LABEL=Object.freeze({search:'nav.search',statics:'features.statics.title',culture:'features.culture.title',trace:'features.trace.title'});

export default function ScopeGroupOverview({scopeId='loc',featureId='search',title='',description=''}){
  useUiSection('uiExtra.scopeGroup');
  const t=useUiText();
  const native=useNativeNavigation();
  const query=useAsyncResource(['scope-group-overview',scopeId],()=>selectScopeGroupChildren(scopeId));
  const scopes=query.data||[];
  const featurePath=FEATURE_PATH[featureId]||'';
  const featureLabel=t(FEATURE_LABEL[featureId]||'uiExtra.scopeGroup.unknownFeature');

  return <section className="scope-card scope-group-overview">
    <h2>{title||t('uiExtra.scopeGroup.directoryTitle')}</h2>
    {query.error?<p className="scope-status scope-error">{query.error.message}</p>:null}
    <div className="scope-list">
      {scopes.map(row=><article className="scope-inline-card" key={row.scope_id}>
        <strong>{row.display_name||row.scope_id}</strong>
        <span>{row.domain||row.directory||'—'}</span>
        <div className="scope-result-links">
          <ScopeLink href={navigationHref(row.scope_id,'',native)} native={native}><UiText id="uiExtra.scopeGroup.memberHome"/></ScopeLink>
          {featurePath?<ScopeLink href={navigationHref(row.scope_id,featurePath,native)} native={native}><UiText id="uiExtra.scopeGroup.openMemberFeature" params={{feature:featureLabel}}/></ScopeLink>:null}
        </div>
      </article>)}
      {!query.isPending&&!query.error&&!scopes.length?<p className="scope-status"><UiText id="uiExtra.scopeGroup.noMembers"/></p>:null}
    </div>
  </section>;
}
