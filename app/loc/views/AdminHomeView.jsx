'use client';
import {registerDefaultSection} from '../../i18n/ui-copy';
import {useUiCopy,useUiSection} from '../../i18n/ui-locale';
import adminZh from '../../i18n/sections/admin.zh_tw.js';
import adminViewZh from '../../i18n/sections/uiExtra.adminView.zh_tw.js';
registerDefaultSection('admin',adminZh);
registerDefaultSection('uiExtra.adminView',adminViewZh);
import {useEffect,useState} from 'react';
import dynamic from 'next/dynamic';
import {useAccount} from '../use-account';
import {useEditDock} from '../../modular/edit-dock';
import {editorSessionStatus,clearEditorSession,touchEditorSession} from '../edit-session-ttl.mjs';
import {FeaturePage} from '../../modular/ui';
import ManagementWorkspaceFrame from '../ManagementWorkspaceFrame';
import ManagementSectionNav,{useManagementSection} from '../../modular/ManagementSectionNav';
import PanelLoading from '../PanelLoading';
// Group member display-name editing lives in the Group People/Works page.
// Admin keeps only privileged registry provisioning and system configuration.

const ADMIN_OPTIONS=Object.freeze([
  {value:'lists',label:'系統名單',shortLabel:'名單',description:'管理員專屬的 Email 黑名單設定。'}, 
  {value:'network',label:'網路設定',shortLabel:'網路',description:'資料庫連線、ISR 快取與認證來源設定。'},
  {value:'io',label:'系統設定',shortLabel:'系統設定',description:'系統匯入、匯出及批次限制。'},
  {value:'featureHero',label:'功能區塊設定',shortLabel:'區塊',description:'編輯功能頁 Hero 與展示資源。'},
  {value:'themes',label:'主題顏色設定',shortLabel:'配色',description:'調整網站主題和色彩。'}
]);
const EnterpriseAuthReserved=dynamic(()=>import('./admin-panels/EnterpriseAuthReserved'),{loading:PanelLoading});
const DatabaseTarget=dynamic(()=>import('./admin-panels/DatabaseTarget'),{loading:PanelLoading});
const IsrDomainTarget=dynamic(()=>import('./admin-panels/IsrDomainTarget'),{loading:PanelLoading});
const RuntimeIoSettings=dynamic(()=>import('./admin-panels/RuntimeIoSettings'),{loading:PanelLoading});
const ThemeEditor=dynamic(()=>import('./admin-panels/ThemeEditor'),{loading:PanelLoading});
const AdminEmailBlocklist=dynamic(()=>import('./admin-panels/AdminEmailBlocklist'),{loading:PanelLoading});
const FeatureHeroImages=dynamic(()=>import('./admin-panels/FeatureHeroImages'),{loading:PanelLoading});

export default function AdminHomeView({scopeGroup}){
  useUiSection('admin');
  useUiSection('uiExtra.adminView');
  const UI_COPY=useUiCopy();
  const account=useAccount();
  const editDock=useEditDock();
  const [entryVerified,setEntryVerified]=useState(false);
  const canManage=Boolean(account.user&&!account.loading&&!account.permissionLoading&&account.canManageGlobalSync());
  // Preserve deep links created before the Admin sections were consolidated.
  const [section,setSection]=useManagementSection(ADMIN_OPTIONS,'lists',{ 
    registry:'lists',members:'lists',
    database:'network',isr:'network',enterpriseAuth:'network',auth:'network',system:'network',
    blocklist:'lists',
    traceAnchor:'network',traceMap:'network'
  });
  const switchSection=next=>{
    if(next===section)return;
    // No Next.js navigation: update the right-hand panel immediately in React.
    // The EditDock still guards unsaved drafts before applying the selection.
    if(editDock?.active)editDock.switchSection(next,setSection);
    else setSection(next);
  };
  // Global Admin is an independent protected route. Its authorization must
  // pass before the edit dock becomes available.
  useEffect(()=>{
    if(account.loading||account.permissionLoading)return;
    const target=window.location.pathname+window.location.search+window.location.hash;
    const fromLogin=window.sessionStorage.getItem('loc-management-login-return-v1')===target;
    if(fromLogin)window.sessionStorage.removeItem('loc-management-login-return-v1');
    if(!canManage||!fromLogin&&editorSessionStatus(window.sessionStorage).expired){
      setEntryVerified(false);
      window.dispatchEvent(new CustomEvent('loc-management-entry-denied',{detail:{scopeId:'loc'}}));
      window.location.replace('/login/index.html?return_to='+encodeURIComponent(target));
      return;
    }
    if(fromLogin){
      clearEditorSession(window.sessionStorage);
      if(!touchEditorSession(window.sessionStorage))return;
    }
    setEntryVerified(true);
    editDock?.begin('loc',{globalManage:true});
  },[account.loading,account.permissionLoading,canManage,editDock?.begin]);
  const selectedOption=ADMIN_OPTIONS.find(option=>option.value===section)||ADMIN_OPTIONS[0];

  if(account.loading||account.permissionLoading)return <section className="loc-view"><div className="loc-card">{UI_COPY.admin.checking}</div></section>;
  if(!canManage||!entryVerified)return <FeaturePage featureId="admin">
    <section className="loc-card scope-feature-card"><p role="status">正在開啟 LOC 身分驗證…</p></section>
  </FeaturePage>;

  return <FeaturePage featureId="admin">
    <ManagementWorkspaceFrame level="admin" title="系統管理">
      <ManagementSectionNav id="admin-sections" title="系統管理" panelId="admin-management-panel"
        items={ADMIN_OPTIONS} value={section} onChange={switchSection}/>
      <div className="management-workspace-panel" id="admin-management-panel" role="region"
        aria-labelledby={'admin-sections-option-'+selectedOption.value}>
        {section==='lists'?<>
          <AdminEmailBlocklist/>
        </>:null}
        {section==='network'?<>
          <DatabaseTarget scopeGroup={scopeGroup}/>
          <IsrDomainTarget/>
          <EnterpriseAuthReserved/>
        </>:null}
        {section==='io'?<RuntimeIoSettings/>:null}
        {section==='featureHero'?<FeatureHeroImages/>:null}
        {section==='themes'?<ThemeEditor/>:null}

      </div>
    </ManagementWorkspaceFrame>
  </FeaturePage>;
}
