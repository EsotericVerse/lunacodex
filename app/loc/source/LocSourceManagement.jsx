'use client';

import dynamic from 'next/dynamic';
import LocManagementWorkspace from '../management/LocManagementWorkspace';
import ManagementWorkspaceFrame from '../management/ManagementWorkspaceFrame';
import ManagementNetworkNav from '../../modular/ManagementNetworkNav';
import {ManagementSectionTransition,useManagementSection} from '../../modular/ManagementSectionNav';
import {useEditDock} from '../../modular/edit-dock';
import {useVerifiedManagementGrants} from '../management/ManagementAccess';
import PanelLoading from '../ui/PanelLoading';
import {ProtectedManagementSlot} from '../management/ManagementAccess';

// Registry provisioning and member maintenance now share Group Management.
const AdminRegistry=dynamic(()=>import('../views/admin-panels/AdminRegistry'),{loading:PanelLoading});
const AdminSourceCategories=dynamic(()=>import('./SourceCategoryEditor').then(mod=>mod.AdminSourceCategories),{loading:PanelLoading});

const OPTIONS=Object.freeze([
  {value:'directory',label:'人員與群組',shortLabel:'人員與群組',description:'管理群組、人員、頁面設定與管理關係。'}
]);
const SOURCE_OPTION=Object.freeze({value:'sources',label:'文章來源',shortLabel:'文章來源',description:'LOC 固定的 Universe／Galaxy／Domain／From 來源階層。'});
const ITEM=Object.freeze({value:'members',label:'群組管理'});

export default function LocSourceManagement(){
  const account=useVerifiedManagementGrants();
  const canManageRootGroup=account.canLocAccessSync('global')||account.canLocAccessSync('group','loc');
  // The published section labels are static. Permissions decide
  // whether privileged editors mount, not whether the menu exists.
  const sections=[...OPTIONS,SOURCE_OPTION];
  const [section,setSection]=useManagementSection(sections,'directory');
  const editDock=useEditDock();
  return <LocManagementWorkspace featureId="culture" navId="loc-source-sections" item={ITEM} standalone>
    <ManagementWorkspaceFrame level="group" title="群組管理">
      <ManagementNetworkNav id="loc-source-sections" title="群組管理" panelId="loc-source-panel"
        items={sections} value={section} onChange={next=>{
          if(next===section)return;
          if(editDock?.active)editDock.switchSection(next,setSection);
          else setSection(next);
        }}/>
      <div id="loc-source-panel" className="management-workspace-panel" role="region"
        aria-labelledby="loc-source-sections-selected-title">
        <ManagementSectionTransition value={section}>
        <ProtectedManagementSlot>
          {section==='directory'?<AdminRegistry/>:null}
          {section==='sources'&&canManageRootGroup?<AdminSourceCategories/>:null}
          {section==='sources'&&!canManageRootGroup
            ?<p className="scope-status">目前沒有 LOC 根群組管理權限。</p>:null}
        </ProtectedManagementSlot>
        </ManagementSectionTransition>
      </div>
    </ManagementWorkspaceFrame>
  </LocManagementWorkspace>;
}
