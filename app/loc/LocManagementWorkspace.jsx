'use client';

import {FeaturePage} from '../modular/ui';
import ManagementWorkspaceFrame from './ManagementWorkspaceFrame';
import ManagementSectionNav from '../modular/ManagementSectionNav';

// Shared workspace layout and access boundary; each management capability
// still owns its own route, data, editor, and lifecycle.
export default function LocManagementWorkspace({featureId,navId,item,children,standalone=false}){
  if(standalone)return <FeaturePage featureId={featureId}>{children}</FeaturePage>;

  const panelId=navId+'-panel';
  return <FeaturePage featureId={featureId}>
    <ManagementWorkspaceFrame level="group" title={item.label}>
      <ManagementSectionNav id={navId} title={item.label} panelId={panelId}
        items={[item]} value={item.value} onChange={()=>{}}/>
      <div className="management-workspace-panel" id={panelId} role="region"
        aria-labelledby={navId+'-option-'+item.value}>
        {children}
      </div>
    </ManagementWorkspaceFrame>
  </FeaturePage>;
}
