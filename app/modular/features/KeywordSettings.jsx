'use client';
import {lazy,Suspense} from 'react';

import UiText from '../../i18n/UiText';
import {useAccount} from '../../loc/auth/use-account';
import {useScopeRuntime} from '../use-scope-runtime';
import {useEditDock} from '../edit-dock';
import {FeaturePage} from '../ui';
import ManagementWorkspaceFrame from '../../loc/management/ManagementWorkspaceFrame';
import {useUiSection} from '../../i18n/ui-locale';

const LazyKeywordLibraryPanel=lazy(()=>import('../../loc/keywords/ui/KeywordLibraryPanel'));
const KeywordLibraryPanelLoading=()=> <p className="scope-status"><UiText id="uiExtra.keywords.settingsLoading"/></p>;
function KeywordLibraryPanel(props){return <Suspense fallback={<KeywordLibraryPanelLoading/>}><LazyKeywordLibraryPanel {...props}/></Suspense>;}

export default function KeywordSettings(){
  useUiSection('uiExtra.keywords');
  const {scopeId,scope}=useScopeRuntime();
  const account=useAccount();
  const editDock=useEditDock();
  const authorized=Boolean(account.user&&editDock?.active&&editDock.scopeId===scopeId&&
    scopeId!=='loc'&&!scope?.aggregateChildren&&account.canLocAccessSync('scope',scopeId));
  return <FeaturePage featureId="statics">
    <ManagementWorkspaceFrame level="scope" title="關鍵詞管理">
      <div className="management-workspace-panel" role="region" aria-label="關鍵詞管理">
    {account.loading||account.permissionLoading
      ?<p className="scope-status"><UiText id="uiExtra.keywords.verifyingAccess"/></p>
      :authorized?<KeywordLibraryPanel scopeId={scopeId} account={account}/>
      :<section className="loc-card scope-feature-card"><p className="scope-status"><UiText id="uiExtra.keywords.accessDenied"/></p></section>}
      </div>
    </ManagementWorkspaceFrame>
  </FeaturePage>;
}
