'use client';

import dynamic from 'next/dynamic';
import LocManagementWorkspace from './LocManagementWorkspace';
import ManagementWorkspaceFrame from './ManagementWorkspaceFrame';
import ManagementSectionNav,{useManagementSection} from '../modular/ManagementSectionNav';
import {useEditDock} from '../modular/edit-dock';
import {useAccount} from './use-account';
import PanelLoading from './PanelLoading';

// Group members and work classifications are editable here without system
// privileges. System accounts, reserved IDs and Email belong to /admin.
const WorkClassificationPage=dynamic(()=>import('./WorkClassificationPage'),{loading:PanelLoading});
const LocGroupMemberList=dynamic(()=>import('./LocGroupMemberList'),{loading:PanelLoading});
const AdminRegistry=dynamic(()=>import('./views/admin-panels/AdminRegistry'),{loading:PanelLoading});

const OPTIONS=Object.freeze([
  {value:'works',label:'作品群組分類',shortLabel:'作品群組分類',description:'管理全站的作品群組分類名稱。'},
  {value:'members',label:'人員',shortLabel:'人員',description:'僅修改所屬人員的顯示名稱，不變更帳號或 Email。'}
]);
const ITEM=Object.freeze({value:'works',label:'人員作品管理'});

export default function LocSourceManagement(){
  const [section,setSection]=useManagementSection(OPTIONS,'works');
  const editDock=useEditDock();
  const account=useAccount();
  const isSystemAdmin=Boolean(account.user&&!account.loading&&!account.permissionLoading&&account.canManageGlobalSync());
  const selected=OPTIONS.find(option=>option.value===section)||OPTIONS[0];
  return <LocManagementWorkspace featureId="culture" navId="loc-source-sections" item={ITEM} standalone>
    <ManagementWorkspaceFrame level="group" title="人員作品管理">
      <ManagementSectionNav id="loc-source-sections" title="人員作品管理" panelId="loc-source-panel"
        items={OPTIONS} value={section} onChange={next=>{
          if(next===section)return;
          if(editDock?.active)editDock.switchSection(next,setSection);
          else setSection(next);
        }}/>
      <div id="loc-source-panel" className="management-workspace-panel" role="region"
        aria-labelledby={'loc-source-sections-option-'+selected.value}>
        {section==='works'?<WorkClassificationPage/>:null}
        {section==='members'?<>
          <LocGroupMemberList groupId="loc"/>
          {isSystemAdmin?<AdminRegistry/>:null}
        </>:null}
      </div>
    </ManagementWorkspaceFrame>
  </LocManagementWorkspace>;
}
