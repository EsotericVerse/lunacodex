'use client';

import dynamic from 'next/dynamic';
import LocManagementWorkspace from '../management/LocManagementWorkspace';
import ManagementWorkspaceFrame from '../management/ManagementWorkspaceFrame';
import ManagementSectionNav,{ManagementSectionTransition,useManagementSection} from '../../modular/ManagementSectionNav';
import {useEditDock} from '../../modular/edit-dock';
import {useVerifiedManagementGrants} from '../management/ManagementAccess';
import PanelLoading from '../ui/PanelLoading';
import {ProtectedManagementSlot} from '../management/ManagementAccess';

// Group managers edit work classifications and member names here.
// Global Admin reuses its existing vis-network personnel editor here.
// Source hierarchy shares the same destination, without widening write access.
const LocGroupMemberList=dynamic(()=>import('../scope/LocGroupMemberList'),{loading:PanelLoading});
const AdminSourceCategories=dynamic(()=>import('./SourceCategoryEditor').then(mod=>mod.AdminSourceCategories),{loading:PanelLoading});

const OPTIONS=Object.freeze([
  {value:'members',label:'人員',shortLabel:'人員',description:'僅修改所屬人員的顯示名稱，不變更帳號或 Email。'}
]);
const SOURCE_OPTION=Object.freeze({value:'sources',label:'文章來源',shortLabel:'文章來源',description:'LOC 固定的 Universe／Galaxy／Domain／From 來源階層。'});
const ITEM=Object.freeze({value:'members',label:'人員作品管理'});

export default function LocSourceManagement(){
  const account=useVerifiedManagementGrants();
  const isSystemAdmin=account.canLocAccessSync('global');
  // The published section labels are static. Permissions decide
  // whether privileged editors mount, not whether the menu exists.
  const sections=[...OPTIONS,SOURCE_OPTION];
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
        <ManagementSectionTransition value={section}>
        <ProtectedManagementSlot>
          {section==='members'?<LocGroupMemberList groupId="loc"/>:null}
          {section==='sources'&&isSystemAdmin?<AdminSourceCategories/>:null}
          {section==='sources'&&!isSystemAdmin
            ?<p className="scope-status">這項功能需要系統管理權限。</p>:null}
        </ProtectedManagementSlot>
        </ManagementSectionTransition>
      </div>
    </ManagementWorkspaceFrame>
  </LocManagementWorkspace>;
}
