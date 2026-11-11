'use client';

import {useEffect} from 'react';
import dynamic from 'next/dynamic';
import {useSearchParams} from 'next/navigation';
import {useEditDock} from '../modular/edit-dock';
import {FeaturePage} from '../modular/ui';
import ManagementWorkspaceFrame from './ManagementWorkspaceFrame';
import ManagementSectionNav,{useManagementSection} from '../modular/ManagementSectionNav';
import PanelLoading from './PanelLoading';
import {recoverChunkOnce} from './chunk-recovery.mjs';
import {PLACE_OPTIONS} from './PlaceManagement';

const TraceManagementPanel=dynamic(()=>import('./TraceManagement'),{loading:PanelLoading});
const PlaceManagement=dynamic(()=>import('./PlaceManagement').catch(recoverChunkOnce),{loading:PanelLoading});

const SPATIAL_OPTIONS=[
  {value:'path',label:'路線',description:'依序連接空間定錨點'},
  {value:'trace',label:'痕跡',description:'組合路線與痕跡線段'}
];
const PLACE_KEYS=new Set(PLACE_OPTIONS.map(item=>item.value));

export default function ScopeManagement({scopeId:routeScopeId='loc',section:entrySection=''}){
  const editDock=useEditDock();
  const searchParams=useSearchParams();
  const isLoc=routeScopeId==='loc';
  const traceOnly=entrySection==='traceMap';
  // Spatial tasks are the first-level navigation. No extra "地點管理" layer.
  const options=isLoc?[]:[...PLACE_OPTIONS.slice(0,1),...SPATIAL_OPTIONS,...PLACE_OPTIONS.slice(1)];
  const requestedSection=searchParams?.get('section');

  // Preserve bookmarks into the old second-level Settings / Group Access
  // and the previously moved Import / Preferences panels.
  useEffect(()=>{
    if(!['settings','groupAccess','import','others'].includes(requestedSection))return;
    if(isLoc&&requestedSection!=='groupAccess')return;
    const url=new URL(window.location.href);
    const replacement=isLoc
      ?url.pathname.replace(/\/trace\/manage(?:\/index\.html|\/)?$/,'/search/manage/')
      :url.pathname.replace(/\/manage(?:\/index\.html|\/)?$/,'/search/manage/');
    if(replacement===url.pathname)return;
    url.pathname=replacement;
    window.location.replace(url.href);
  },[isLoc,requestedSection]);

  const [section,setSection]=useManagementSection(options,'anchor',
    {traceAnchor:'anchor',placeManage:'anchor',traceMap:'trace'});
  const selectedOption=options.find(option=>option.value===section)||options[0];
  if(isLoc)return <FeaturePage featureId="trace"><p className="scope-status">LOC 不管理空間定錨；請進入各 Scope 的空間定錨管理頁。</p></FeaturePage>;
  return <FeaturePage featureId={isLoc||traceOnly?'trace':'manage'}>
    <div className={PLACE_KEYS.has(section)
      ?'scope-management-layout scope-management-layout--anchor':'scope-management-layout'}>
      <ManagementWorkspaceFrame level={isLoc?'group':'scope'}
        title={traceOnly?'痕跡圖管理':'空間定錨管理'}>
        <ManagementSectionNav id="scope-sections" title="空間定錨管理" panelId="scope-management-panel"
          items={options} value={section} mobileSelect onChange={next=>{
            if(next===section)return;
            if(editDock?.active)editDock.switchSection(next,setSection);
            else setSection(next);
          }}/>
        <div className="management-workspace-panel" id="scope-management-panel" role="region"
          aria-labelledby={'scope-sections-option-'+selectedOption.value}>
          {PLACE_KEYS.has(section)?<PlaceManagement scopeId={routeScopeId} section={section}/>:null}
          {section==='path'||section==='trace'?<TraceManagementPanel key={section} scopeId={routeScopeId} mode="map" routeMode={section}/>:null}
        </div>
      </ManagementWorkspaceFrame>
    </div>
  </FeaturePage>;
}
