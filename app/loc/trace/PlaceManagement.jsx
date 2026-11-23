'use client';

import {useState} from 'react';
import dynamic from 'next/dynamic';
import PanelLoading from '../ui/PanelLoading';
import {useEditDock} from '../../modular/edit-dock';
import {useAsyncResource} from '../../../packages/zenstack/client-queries';
import {TRACE_SCOPES,readTraceData,traceKey} from '../../modular/features/trace/trace-data';
import TimelinePlaceManager from './TimelinePlaceManager';

const TraceManagement=dynamic(()=>import('./TraceManagement'),{loading:PanelLoading});
const PlaceBatchFill=dynamic(()=>import('./PlaceBatchFill'),{loading:PanelLoading});

// Only the management navigation is consolidated. The two organization
// operations retain their independent forms, actions, and write contracts.
export const PLACE_OPTIONS=Object.freeze([
  {value:'anchor',label:'空間定錨',description:'痕跡、路徑、空間定錨點階層列表'},
  {value:'organize',label:'地點整理',description:'名稱整理與快速補打卡'},
  {value:'timeline',label:'地點對照',description:'Google Timeline 行蹤比對及文章定錨'}
]);

export default function PlaceManagement({scopeId,section='organize',initialOperation='names'}){
  const dock=useEditDock();
  const [operation,setOperation]=useState(initialOperation);
  const query=useAsyncResource(traceKey(scopeId,{includeHidden:true}),
    ()=>readTraceData(scopeId,{includeHidden:true}),{
      enabled:section==='organize'&&TRACE_SCOPES.includes(scopeId),
      revalidateOnFocus:false,revalidateOnReconnect:false
    });
  const spatial=query.data;
  const switchOperation=next=>{
    if(next===operation)return;
    if(dock?.active)dock.switchSection(next,setOperation);
    else setOperation(next);
  };
  return <section className="loc-place-workspace" aria-label="空間定錨管理">
    <div className="loc-place-workspace__panel">
      {section==='organize'?<>
        <div className="scope-culture-record-browser-row" role="group" aria-label="地點整理功能">
          <button type="button" className="loc-button" aria-pressed={operation==='names'}
            onClick={()=>switchOperation('names')}>名稱整理</button>
          <button type="button" className="loc-button" aria-pressed={operation==='quickFill'}
            onClick={()=>switchOperation('quickFill')}>快速補打卡</button>
        </div>
        {query.error?<p className="scope-status scope-error" role="alert">
          {String(query.error.message||query.error)}</p>:null}
        {query.isPending||!spatial?<p className="scope-status" role="status">正在載入地點…</p>:null}
        {spatial&&operation==='names'?<TraceManagement scopeId={scopeId}
          mode="cleanup" spatialData={spatial} reloadSpatial={()=>query.mutate()}/>:null}
        {spatial&&operation==='quickFill'?<PlaceBatchFill scopeId={scopeId}
          anchors={spatial.anchors}/>:null}
      </>:null}
      {section==='timeline'?<TimelinePlaceManager scopeId={scopeId}/>:null}
    </div>
  </section>;
}
