'use client';

import dynamic from 'next/dynamic';
import UiText from '../../i18n/UiText';
import {useAccount} from '../../loc/use-account';
import {useScopeRuntime} from '../use-scope-runtime';
import {useEditDock} from '../edit-dock';
import {FeaturePage} from '../ui';
import ManagementWorkspaceFrame from '../../loc/ManagementWorkspaceFrame';
import {registerDefaultSection} from '../../i18n/ui-copy';
import {useUiSection} from '../../i18n/ui-locale';
import keywordsZh from '../../i18n/sections/uiExtra.keywords.zh_tw.js';
registerDefaultSection('uiExtra.keywords',keywordsZh);

const KeywordLibraryPanel=dynamic(()=>import('../../loc/KeywordLibraryPanel'),{
  loading:()=> <p className="scope-status"><UiText id="uiExtra.keywords.settingsLoading"/></p>
});

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
