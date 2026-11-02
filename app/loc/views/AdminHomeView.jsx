'use client';
import {registerDefaultSection} from '../../i18n/ui-copy';
import {useUiCopy,useUiSection} from '../../i18n/ui-locale';
import adminZh from '../../i18n/sections/admin.zh_tw.js';
import adminViewZh from '../../i18n/sections/uiExtra.adminView.zh_tw.js';
registerDefaultSection('admin',adminZh);
registerDefaultSection('uiExtra.adminView',adminViewZh);
import {useEffect} from 'react';
import dynamic from 'next/dynamic';
import {useAccount} from '../use-account';
import {useEditDock} from '../../modular/edit-dock';
import {FeaturePage} from '../../modular/ui';
import ManagementSectionNav,{useManagementSection} from '../../modular/ManagementSectionNav';
import PanelLoading from '../PanelLoading';
// Registry editing and source catalogs are independent admin capabilities.

const ADMIN_OPTIONS=Object.freeze([
  {value:'registry',label:'人員',shortLabel:'人員',description:'系統人員、Email、Table 對應及群組部署。'},
  {value:'lists',label:'名單管理',shortLabel:'名單',description:'保留名稱備註及 Email 系統黑名單。'},
  {value:'enterpriseAuth',label:'企業認證（預備）',shortLabel:'企業認證',description:'AD／LDAP 企業登入模組預留設定；目前不啟用。'},
  {value:'network',label:'網路設定',shortLabel:'網路',description:'資料庫連線、備援及快取／ISR 平台。'},
  {value:'io',label:'系統設定',shortLabel:'系統設定',description:'系統匯入、匯出及批次限制。'},
  {value:'featureHero',label:'功能區塊設定',shortLabel:'區塊',description:'編輯功能頁 Hero 與展示資源。'},
  {value:'themes',label:'主題顏色設定',shortLabel:'配色',description:'調整網站主題和色彩。'}
]);
function Login({account}){
  return <FeaturePage featureId="admin">
    <section className="loc-card scope-feature-card">
      <p>請先至設定首頁登入。</p>
      {account.error?<p className="scope-status scope-error">{account.error}</p>:null}
    </section>
  </FeaturePage>;
}

const EnterpriseAuthReserved=dynamic(()=>import('./admin-panels/EnterpriseAuthReserved'),{loading:PanelLoading});
const DatabaseTarget=dynamic(()=>import('./admin-panels/DatabaseTarget'),{loading:PanelLoading});
const IsrDomainTarget=dynamic(()=>import('./admin-panels/IsrDomainTarget'),{loading:PanelLoading});
const RuntimeIoSettings=dynamic(()=>import('./admin-panels/RuntimeIoSettings'),{loading:PanelLoading});
const ThemeEditor=dynamic(()=>import('./admin-panels/ThemeEditor'),{loading:PanelLoading});
const AdminEmailBlocklist=dynamic(()=>import('./admin-panels/AdminEmailBlocklist'),{loading:PanelLoading});
const FeatureHeroImages=dynamic(()=>import('./admin-panels/FeatureHeroImages'),{loading:PanelLoading});
const AdminRegistry=dynamic(()=>import('./admin-panels/AdminRegistry'),{loading:PanelLoading});
const AdminReservedScopeIds=dynamic(()=>import('./admin-panels/AdminReservedScopeIds'),{loading:PanelLoading});

export default function AdminHomeView({scopeGroup}){
  useUiSection('admin');
  useUiSection('uiExtra.adminView');
  const UI_COPY=useUiCopy();
  const account=useAccount();
  const editDock=useEditDock();
  const canManage=Boolean(account.user&&!account.loading&&!account.permissionLoading&&account.canManageGlobalSync());
  // Preserve deep links created before the Admin sections were consolidated.
  const [section,setSection]=useManagementSection(ADMIN_OPTIONS,'registry',{
    database:'network',isr:'network',system:'network',
    reserved:'lists',blocklist:'lists',
    traceAnchor:'network',traceMap:'network'
  });
  const switchSection=next=>{
    if(next===section)return;
    // No Next.js navigation: update the right-hand panel immediately in React.
    // The EditDock still guards unsaved drafts before applying the selection.
    if(editDock?.active)editDock.switchSection(next,setSection);
    else setSection(next);
  };
  // Admin edit mode remains guarded by the global management permission.
  useEffect(()=>{
    if(canManage)editDock?.begin('loc');
  },[canManage,editDock?.begin]);
  const selectedOption=ADMIN_OPTIONS.find(option=>option.value===section)||ADMIN_OPTIONS[0];

  if(account.loading||account.permissionLoading)return <section className="loc-view"><div className="loc-card">{UI_COPY.admin.checking}</div></section>;
  if(!account.user)return <Login account={account}/>;
  if(!account.canManageGlobalSync())return <FeaturePage featureId="admin"><section className="loc-card scope-feature-card"><p>{UI_COPY.admin.denied}</p></section></FeaturePage>;

  return <FeaturePage featureId="admin">
    <div className="management-workspace">
      <ManagementSectionNav id="admin-sections" title="系統管理" panelId="admin-management-panel"
        items={ADMIN_OPTIONS} value={section} onChange={switchSection}/>
      <div className="management-workspace-panel" id="admin-management-panel" role="region"
        aria-labelledby={'admin-sections-option-'+selectedOption.value}>
        {section==='registry'?<AdminRegistry/>:null}
        {section==='lists'?<>
          <AdminReservedScopeIds/>
          <AdminEmailBlocklist/>
        </>:null}
        {section==='network'?<>
          <DatabaseTarget scopeGroup={scopeGroup}/>
          <IsrDomainTarget/>
        </>:null}
        {section==='enterpriseAuth'?<EnterpriseAuthReserved/>:null}
        {section==='io'?<RuntimeIoSettings/>:null}
        {section==='featureHero'?<FeatureHeroImages/>:null}
        {section==='themes'?<ThemeEditor/>:null}

      </div>
    </div>
  </FeaturePage>;
}
