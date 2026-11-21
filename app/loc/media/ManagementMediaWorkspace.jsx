'use client';
import {lazy,Suspense} from 'react';

import {useState} from 'react';
import {useEditDock} from '../../modular/edit-dock';

const LazyManagementMediaPublisher=lazy(()=>import('./ManagementMediaPublisher'));
function ManagementMediaPublisher(props){return <Suspense fallback={null}><LazyManagementMediaPublisher {...props}/></Suspense>;}
const LazySunoImportPanel=lazy(()=>import('./SunoImportPanel'));
const SunoImportPanelLoading=()=> <p role="status" className="scope-status">正在載入 Suno 音樂編輯器…</p>;
function SunoImportPanel(props){return <Suspense fallback={<SunoImportPanelLoading/>}><LazySunoImportPanel {...props}/></Suspense>;}

// Suno is a multimedia publishing workflow, not an independent management
// category. Keep each editor's writes and authorization in its existing owner.
const MEDIA_KINDS=Object.freeze([
  {value:'media',label:'一般多媒體'},
  {value:'suno',label:'Suno 音樂'}
]);

export default function ManagementMediaWorkspace({scopeId,dockScopeId=scopeId,globalAdmin=false}){
  const [kind,setKind]=useState('media');
  const editDock=useEditDock();
  function choose(next){
    if(next===kind)return;
    if(editDock?.active)editDock.switchSection(next,setKind);
    else setKind(next);
  }
  return <section className="management-media-workspace">
    <div className="scope-preview-links" role="group" aria-label="多媒體發表類型">
      {MEDIA_KINDS.map(item=><button type="button" key={item.value}
        className={'loc-button'+(item.value===kind?' primary':'')}
        aria-pressed={item.value===kind}
        onClick={()=>choose(item.value)}>{item.label}</button>)}
    </div>
    {kind==='media'?<ManagementMediaPublisher scopeId={scopeId} dockScopeId={dockScopeId} globalAdmin={globalAdmin}/>:
      <SunoImportPanel scopeId={scopeId} dockScopeId={dockScopeId} globalAdmin={globalAdmin}/>}
  </section>;
}
