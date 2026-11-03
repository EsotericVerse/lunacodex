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

const TRACE_OPTION={value:'traceMap',label:'痕跡圖管理',shortLabel:'痕跡圖',
  description:'從已有地點自動完成選點，組合有序 Frame。'};
const PLACE_KEYS=new Set(PLACE_OPTIONS.map(item=>item.value));

export default function ScopeManagement({scopeId:routeScopeId='loc',section:entrySection=''}){
  const editDock=useEditDock();
  const searchParams=useSearchParams();
  const isLoc=routeScopeId==='loc';
  const traceOnly=entrySection==='traceMap';
  // Spatial tasks are the first-level navigation. No extra "地點管理" layer.
  const options=traceOnly?[TRACE_OPTION]
    :isLoc?[...PLACE_OPTIONS.filter(item=>item.value==='anchor'||item.value==='names'),TRACE_OPTION]
      :PLACE_OPTIONS;
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

  const [section,setSection]=useManagementSection(options,traceOnly?'traceMap':isLoc?'traceMap':'anchor',
    {traceAnchor:'anchor',placeManage:'anchor'});
  const selectedOption=options.find(option=>option.value===section)||options[0];
  return <FeaturePage featureId={isLoc||traceOnly?'trace':'manage'}>
    <div className={PLACE_KEYS.has(section)
      ?'scope-management-layout scope-management-layout--anchor':'scope-management-layout'}>
      <ManagementWorkspaceFrame level={isLoc?'group':'scope'}
        title={traceOnly?'痕跡圖管理':'空間定錨管理'}>
        <ManagementSectionNav id="scope-sections" title="空間定錨管理" panelId="scope-management-panel"
          items={options} value={section} onChange={next=>{
            if(next===section)return;
            if(editDock?.active)editDock.switchSection(next,setSection);
            else setSection(next);
          }}/>
        <div className="management-workspace-panel" id="scope-management-panel" role="region"
          aria-labelledby={'scope-sections-option-'+selectedOption.value}>
          {PLACE_KEYS.has(section)?<PlaceManagement scopeId={routeScopeId} section={section}/>:null}
          {section==='traceMap'?<TraceManagementPanel scopeId={routeScopeId} mode="map"/>:null}
        </div>
      </ManagementWorkspaceFrame>
    </div>
  </FeaturePage>;
}
