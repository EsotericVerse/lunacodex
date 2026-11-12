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
  {value:'sources',label:'文章來源',shortLabel:'來源',description:'來源階層與名稱'},
  {value:'featureHero',label:'頁面主視覺',shortLabel:'頁面',description:'功能頁圖片與文字'},
  {value:'themes',label:'主題配色',shortLabel:'配色',description:'主題色彩'},
  {value:'network',label:'連線與驗證',shortLabel:'連線',description:'資料庫、快取與身分驗證'},
  {value:'io',label:'匯入與系統工具',shortLabel:'工具',description:'匯入匯出與系統限制'}
]);
const EnterpriseAuthReserved=dynamic(()=>import('./admin-panels/EnterpriseAuthReserved'),{loading:PanelLoading});
const McpProviderPanel=dynamic(()=>import('./admin-panels/McpProviderPanel'),{loading:PanelLoading});
const DatabaseTarget=dynamic(()=>import('./admin-panels/DatabaseTarget'),{loading:PanelLoading});
const IsrDomainTarget=dynamic(()=>import('./admin-panels/IsrDomainTarget'),{loading:PanelLoading});
const RuntimeIoSettings=dynamic(()=>import('./admin-panels/RuntimeIoSettings'),{loading:PanelLoading});
const SourceCategories=dynamic(()=>import('../SourceCategoryEditor').then(m=>m.AdminSourceCategories),{loading:PanelLoading});
const ThemeEditor=dynamic(()=>import('./admin-panels/ThemeEditor'),{loading:PanelLoading});
const FeatureHeroImages=dynamic(()=>import('./admin-panels/FeatureHeroImages'),{loading:PanelLoading});

export default function AdminHomeView({scopeGroup}){
  useUiSection('admin');
  useUiSection('uiExtra.adminView');
  const UI_COPY=useUiCopy();
  const account=useAccount();
  const editDock=useEditDock();
  const [entryVerified,setEntryVerified]=useState(false);
  const [loginDenied,setLoginDenied]=useState(false);
  const [retrying,setRetrying]=useState(false);
  const canManage=Boolean(account.user&&!account.loading&&!account.permissionLoading&&account.canManageGlobalSync());
  // Preserve deep links created before the Admin sections were consolidated.
  const [section,setSection]=useManagementSection(ADMIN_OPTIONS,'network',{
    registry:'network',members:'network',
    database:'network',isr:'network',enterpriseAuth:'network',auth:'network',system:'network',
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
    if(!canManage||editorSessionStatus(window.sessionStorage).expired){
      setEntryVerified(false);
      setLoginDenied(true);
      window.dispatchEvent(new CustomEvent('loc-management-entry-denied',{detail:{scopeId:'loc'}}));
      return;
    }
    setLoginDenied(false);
    setEntryVerified(true);
    editDock?.begin('loc',{globalManage:true});
  },[account.loading,account.permissionLoading,canManage,editDock?.begin]);
  const retrySession=async()=>{
    if(retrying)return;
    setRetrying(true);
    try{
      const verified=await account.refresh();
      if(!verified?.authorizer?.canManageGlobalSync()){
        setLoginDenied(true);setEntryVerified(false);
        return;
      }
      clearEditorSession(window.sessionStorage);
      if(!touchEditorSession(window.sessionStorage))
        throw Error('無法重新啟用編輯 Session');
      setLoginDenied(false);
      setEntryVerified(true);
      editDock?.begin('loc',{globalManage:true});
    }catch{
      setLoginDenied(true);setEntryVerified(false);
    }finally{setRetrying(false);}
  };
  const selectedOption=ADMIN_OPTIONS.find(option=>option.value===section)||ADMIN_OPTIONS[0];

  if(account.loading||account.permissionLoading)return <section className="loc-view"><div className="loc-card">{UI_COPY.admin.checking}</div></section>;
  if(loginDenied||!canManage)return <FeaturePage featureId="admin">
    <section className="loc-card scope-feature-card">
      <p role="alert">{account.error||(account.user
        ?'目前沒有有效的編輯 Session，或此帳號沒有全域管理權限。'
        :'目前沒有有效的 LOC Session，系統管理未啟用。')}</p>
      <button type="button" onClick={()=>void retrySession()} disabled={retrying}>
        {retrying?'正在確認 Session…':'重新確認 Session'}
      </button>{' '}
      <a href="/local/settings/">前往設定頁</a>
    </section>
  </FeaturePage>;
  if(!canManage||!entryVerified)return <FeaturePage featureId="admin">
    <section className="loc-card scope-feature-card"><p role="status">正在開啟 LOC 身分驗證…</p></section>
  </FeaturePage>;

  return <FeaturePage featureId="admin">
    <ManagementWorkspaceFrame level="admin" title="系統管理">
      <ManagementSectionNav id="admin-sections" title="系統管理" panelId="admin-management-panel"
        items={ADMIN_OPTIONS} value={section} onChange={switchSection} mobileSelect/>
      <div className="management-workspace-panel" id="admin-management-panel" role="region"
        aria-labelledby={'admin-sections-option-'+selectedOption.value}>
        {section==='network'?<>
          <DatabaseTarget scopeGroup={scopeGroup}/>
          <IsrDomainTarget/>
          <EnterpriseAuthReserved/>
          <McpProviderPanel/>
        </>:null}
        {section==='io'?<RuntimeIoSettings/>:null}
        {section==='featureHero'?<FeatureHeroImages/>:null}
        {section==='sources'?<SourceCategories/>:null}
        {section==='themes'?<ThemeEditor/>:null}

      </div>
    </ManagementWorkspaceFrame>
  </FeaturePage>;
}
