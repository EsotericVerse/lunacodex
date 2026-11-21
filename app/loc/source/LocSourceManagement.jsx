'use client';

import dynamic from 'next/dynamic';
import LocManagementWorkspace from '../management/LocManagementWorkspace';
import ManagementWorkspaceFrame from '../management/ManagementWorkspaceFrame';
import ManagementSectionNav,{useManagementSection} from '../../modular/ManagementSectionNav';
import {useEditDock} from '../../modular/edit-dock';
import {useVerifiedManagementGrants} from '../management/ManagementAccess';
import PanelLoading from '../ui/PanelLoading';
import {ProtectedManagementSlot} from '../management/ManagementAccess';

// Group managers edit work classifications and member names here.
// Global Admin reuses its existing vis-network personnel editor here.
// Source hierarchy shares the same destination, without widening write access.
const LocGroupMemberList=dynamic(()=>import('../scope/LocGroupMemberList'),{loading:PanelLoading});
const AdminRegistry=dynamic(()=>import('../views/admin-panels/AdminRegistry'),{loading:PanelLoading});
const AdminSourceCategories=dynamic(()=>import('./SourceCategoryEditor').then(mod=>mod.AdminSourceCategories),{loading:PanelLoading});

const OPTIONS=Object.freeze([
  {value:'members',label:'人員',shortLabel:'人員',description:'僅修改所屬人員的顯示名稱，不變更帳號或 Email。'}
]);
const SYSTEM_PERSONNEL_OPTION=Object.freeze({value:'systemPersonnel',label:'人員架構',shortLabel:'人員架構',description:'以 vis-network 編輯人員階層、身分與所屬設定；僅系統管理員可寫入。'});
const SOURCE_OPTION=Object.freeze({value:'sources',label:'文章來源',shortLabel:'文章來源',description:'LOC 來源 Universe／Galaxy／Domain／From 階層；僅系統管理員可編輯。'});
const ITEM=Object.freeze({value:'members',label:'人員作品管理'});

export default function LocSourceManagement(){
  const account=useVerifiedManagementGrants();
  const isSystemAdmin=account.canLocAccessSync('global');
  // The three published section labels are static. Permissions decide
  // whether privileged editors mount, not whether the menu exists.
  const sections=[SYSTEM_PERSONNEL_OPTION,...OPTIONS,SOURCE_OPTION];
  const [section,setSection]=useManagementSection(sections,'members');
  const editDock=useEditDock();
  const selected=sections.find(option=>option.value===section)||OPTIONS[0];
  return <LocManagementWorkspace featureId="culture" navId="loc-source-sections" item={ITEM} standalone>
    <ManagementWorkspaceFrame level="group" title="人員作品管理">
      <ManagementSectionNav id="loc-source-sections" title="人員作品管理" panelId="loc-source-panel"
        items={sections} value={section} onChange={next=>{
          if(next===section)return;
          if(editDock?.active)editDock.switchSection(next,setSection);
          else setSection(next);
        }}/>
      <div id="loc-source-panel" className="management-workspace-panel" role="region"
        aria-labelledby={'loc-source-sections-option-'+selected.value}>
        <ProtectedManagementSlot>
          {section==='members'?<LocGroupMemberList groupId="loc"/>:null}
          {section==='systemPersonnel'&&isSystemAdmin?<AdminRegistry/>:null}
          {section==='sources'&&isSystemAdmin?<AdminSourceCategories/>:null}
          {['systemPersonnel','sources'].includes(section)&&!isSystemAdmin
            ?<p className="scope-status">這項功能需要系統管理權限。</p>:null}
        </ProtectedManagementSlot>
      </div>
    </ManagementWorkspaceFrame>
  </LocManagementWorkspace>;
}
