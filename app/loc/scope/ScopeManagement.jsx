'use client';

import dynamic from 'next/dynamic';
import {useSearchParams} from 'next/navigation';
import {useEditDock} from '../../modular/edit-dock';
import {FeaturePage} from '../../modular/ui';
import ManagementWorkspaceFrame from '../management/ManagementWorkspaceFrame';
import {ProtectedManagementSlot} from '../management/ManagementAccess';
import ManagementSectionNav,{ManagementSectionTransition,useManagementSection} from '../../modular/ManagementSectionNav';
import PanelLoading from '../ui/PanelLoading';
import {recoverChunkOnce} from '../ui/chunk-recovery.mjs';
import {PLACE_OPTIONS} from '../trace/PlaceManagement';

const UnifiedSpatialManagement=dynamic(()=>import('../trace/UnifiedSpatialManagement').catch(recoverChunkOnce),{loading:PanelLoading});
const PlaceManagement=dynamic(()=>import('../trace/PlaceManagement').catch(recoverChunkOnce),{loading:PanelLoading});

export default function ScopeManagement({scopeId:routeScopeId='loc',section:entrySection=''}){
  const editDock=useEditDock();
  const searchParams=useSearchParams();
  const isLoc=routeScopeId==='loc';
  const traceOnly=entrySection==='traceMap';
  // Space uses one list for Point/Path/Trace, with the other two first-level
  // operations reserved for names/quick fill and Timeline matching.
  const options=isLoc?[]:PLACE_OPTIONS;
  const [section,setSection]=useManagementSection(options,'anchor');
  const selectedOption=options.find(option=>option.value===section)||options[0];
  if(isLoc)return <FeaturePage featureId="trace"><p className="scope-status">LOC 不管理空間定錨；請進入各 Scope 的空間定錨管理頁。</p></FeaturePage>;
  return <FeaturePage featureId={isLoc||traceOnly?'trace':'manage'}>
    <div className={section==='anchor'
      ?'scope-management-layout scope-management-layout--anchor':'scope-management-layout'}>
      <ManagementWorkspaceFrame level={isLoc?'group':'scope'}
        title="空間定錨管理">
        <ManagementSectionNav id="scope-sections" title="空間定錨管理" panelId="scope-management-panel"
          items={options} value={section} mobileSelect onChange={next=>{
            if(next===section)return;
            if(editDock?.active)editDock.switchSection(next,setSection);
            else setSection(next);
          }}/>
        <div className="management-workspace-panel" id="scope-management-panel" role="region"
          aria-labelledby={'scope-sections-option-'+selectedOption.value}>
          <ManagementSectionTransition value={section}>
          <ProtectedManagementSlot>
            {section==='anchor'?<UnifiedSpatialManagement scopeId={routeScopeId}
              initialType={traceOnly?'trace':'point'}
              initialRecordUid={searchParams?.get('frame')||''}/>:null}
            {section==='organize'||section==='timeline'?<PlaceManagement
              scopeId={routeScopeId} section={section}
              initialOperation="names"/>:null}
          </ProtectedManagementSlot>
          </ManagementSectionTransition>
        </div>
      </ManagementWorkspaceFrame>
    </div>
  </FeaturePage>;
}
