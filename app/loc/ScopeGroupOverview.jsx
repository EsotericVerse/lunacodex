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
import StatisticsDashboardKpis from '../modular/modules/statistics/StatisticsDashboardKpis';
import StatisticsScopeNavigation from '../modular/modules/statistics/StatisticsScopeNavigation';
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
  // A DB Scope Group is a directory, not an implicit permission to combine
  // the Galaxy contents of its children. Use only already loaded registry rows.
  if(featureId==='statics'){
    const directScopes=scopes.filter(row=>row.scope_kind==='scope');
    const subgroups=scopes.filter(row=>row.scope_kind==='group');
    return <section className="scope-card scope-group-overview statistics-dashboard statistics-dashboard--group">
      <StatisticsScopeNavigation scopeId={scopeId} currentLabel={title||scopeId}/>
      <header className="scope-stat-domain-heading statistics-dashboard__heading">
        <div>
          <span className="statistics-dashboard__eyebrow">SCOPE / ANALYTICS</span>
          <h2>{title||t('uiExtra.scopeGroup.directoryTitle')}</h2>
          <p>{description||t('uiExtra.scopeGroup.dashboardDescription')}</p>
        </div>
      </header>
      {query.isPending?<p className="scope-status" role="status">{t('uiExtra.scopeGroup.dashboardLoading')}</p>:null}
      {query.error?<p className="scope-status scope-error" role="alert">{query.error.message}</p>:null}
      {!query.isPending&&!query.error?<StatisticsDashboardKpis
        label={t('uiExtra.scopeGroup.dashboardSummary')} items={[
          {key:'members',label:t('uiExtra.scopeGroup.dashboardDirectChildren'),value:scopes.length.toLocaleString()},
          {key:'scopes',label:t('uiExtra.scopeGroup.dashboardScopes'),value:directScopes.length.toLocaleString()},
          {key:'groups',label:t('uiExtra.scopeGroup.dashboardSubgroups'),value:subgroups.length.toLocaleString()}
        ]}/>:null}
      <section className="statistics-dashboard__panel" aria-labelledby="scope-group-dashboard-members">
        <header className="statistics-dashboard__panel-heading">
          <h3 id="scope-group-dashboard-members">{t('uiExtra.scopeGroup.dashboardMemberDashboards')}</h3>
        </header>
        <div className="statistics-dashboard__group-grid">
          {scopes.map(row=><article className="statistics-dashboard__group-card" key={row.scope_id}>
            <div className="statistics-dashboard__group-card-header">
              <strong>{row.display_name||row.scope_id}</strong>
              <span>{row.scope_kind==='group'?t('uiExtra.scopeGroup.dashboardGroupType'):t('uiExtra.scopeGroup.dashboardScopeType')}</span>
            </div>
            <p>{row.domain||row.directory||row.scope_id}</p>
            <div className="scope-result-links">
              <ScopeLink href={navigationHref(row.scope_id,'statics',native)} native={native}>
                {t('uiExtra.scopeGroup.dashboardOpenStatistics')}
              </ScopeLink>
              <ScopeLink href={navigationHref(row.scope_id,'',native)} native={native}>
                <UiText id="uiExtra.scopeGroup.memberHome"/>
              </ScopeLink>
            </div>
          </article>)}
        </div>
        {!query.isPending&&!query.error&&!scopes.length?<p className="scope-status">
          <UiText id="uiExtra.scopeGroup.noMembers"/>
        </p>:null}
      </section>
    </section>;
  }

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
