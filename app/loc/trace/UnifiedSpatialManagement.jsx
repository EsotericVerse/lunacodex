'use client';
import {useCallback,useRef,useState} from 'react';
import {useAsyncResource} from '../../../packages/zenstack/client-queries';
import {TRACE_SCOPES,readTraceData,traceKey} from '../../modular/features/trace/trace-data';
import SpaceAnchorTree from './SpaceAnchorTree';
import TraceManagementPanel from './TraceManagement';
import RouteManager from './RouteManager';

// Shared browser only; Point, Path and Trace still own their existing Save,
// route sequencing, line segments, map picker, and write permission checks.
export default function UnifiedSpatialManagement({scopeId}){
  const [selected,setSelected]=useState({type:'point',uid:'',serial:0});
  const leaveGuard=useRef(null);
  const registerLeave=useCallback(fn=>{leaveGuard.current=fn;},[]);
  const query=useAsyncResource(traceKey(scopeId,{includeHidden:true}),
    ()=>readTraceData(scopeId,{includeHidden:true}),{
      enabled:TRACE_SCOPES.includes(scopeId),revalidateOnFocus:false,revalidateOnReconnect:false
    });
  const pick=useCallback((type,uid='')=>{
    if(type===selected.type&&uid===selected.uid)return;
    if(leaveGuard.current&&!leaveGuard.current())return;
    leaveGuard.current=null;
    setSelected(current=>({type,uid,serial:current.serial+1}));
  },[selected]);
  if(query.error)return <p role="alert" className="scope-status scope-error">{String(query.error.message||query.error)}</p>;
  if(query.isPending||!query.data)return <p className="scope-status" role="status">正在載入空間定錨列表…</p>;
  const spatial=query.data,route=selected.type==='path'||selected.type==='trace';
  return <section className="loc-unified-spatial-manager" aria-label="空間定錨管理">
    <div className="scope-culture-record-browser">
      <SpaceAnchorTree spatial={spatial} scopeId={scopeId}
        value={selected.uid?selected.type+':'+selected.uid:''} onSelect={pick}/>
      <div className="scope-culture-record-browser-row">
        <button type="button" className="loc-button" onClick={()=>pick('point')}>＋ 新增空間定錨點</button>
        <button type="button" className="loc-button" onClick={()=>pick('path')}>＋ 新增路徑</button>
        <button type="button" className="loc-button" onClick={()=>pick('trace')}>＋ 新增痕跡</button>
      </div>
    </div>
    {route?<RouteManager key={scopeId+':'+selected.type+':'+selected.uid+':'+selected.serial}
      scopeId={scopeId} mode="all" treeMode selectedRecordUid={selected.uid}
      initialType={selected.type} spatialData={spatial} reloadSpatial={()=>query.mutate()}
      onRegisterLeave={registerLeave}/>:<TraceManagementPanel
      key={scopeId+':point:'+selected.uid+':'+selected.serial}
      scopeId={scopeId} mode="anchor" embedded selectedUid={selected.uid}
      spatialData={spatial} reloadSpatial={()=>query.mutate()} onRegisterLeave={registerLeave}/>}
  </section>;
}
