'use client';

import {registerDefaultSection} from '../../../i18n/ui-copy';
import {useUiText} from '../../../i18n/UiText';
import statisticsViewZh from '../../../i18n/sections/uiExtra.statisticsView.zh_tw.js';
import {SCOPE_ROUTE_INDEX} from '../../scope-route-index.js';
import {navigationHref} from '../../scope-registry.js';
import ScopeLink from '../../ScopeLink';
import useNativeNavigation from '../../use-native-navigation';

registerDefaultSection('uiExtra.statisticsView',statisticsViewZh);

// The published PUBLIC route index is enough to draw the navigation.
// Do not introduce a registry, auth, or cross-Scope content query.
export default function StatisticsScopeNavigation({scopeId='',currentLabel=''}) {
  const t=useUiText();
  const native=useNativeNavigation();
  const published=SCOPE_ROUTE_INDEX.filter(row=>row.active!==false
    &&row.config?.statistics_able!==false&&row.config?.able?.statics!==0);
  const rows=published.map(row=>({
    id:row.scope_id,
    label:String(row.config?.display_name||row.scope_id)
  }));
  if(scopeId&&!rows.some(row=>row.id===scopeId)){
    rows.push({id:scopeId,label:currentLabel||scopeId});
  }
  return <nav className="statistics-dashboard__scope-nav" aria-label={t('uiExtra.statisticsView.dashboardScopeNavigation')}>
    <span className="statistics-dashboard__scope-nav-label">{t('uiExtra.statisticsView.dashboardScopeNavigation')}</span>
    <div className="statistics-dashboard__scope-nav-items">
      {rows.map(row=><ScopeLink key={row.id}
        href={navigationHref(row.id,'statics',native)}
        native={native}
        className="statistics-dashboard__scope-link"
        aria-current={row.id===scopeId?'page':undefined}>
        {row.label}
      </ScopeLink>)}
    </div>
  </nav>;
}
