'use client';
import {useCallback,useRef,useState} from 'react';
import {useAsyncResource} from '../../../packages/zenstack/client-queries';
import {TRACE_SCOPES,readTraceData,traceKey} from '../../modular/features/trace/trace-data';
import SpaceAnchorTree from './SpaceAnchorTree';
import TraceManagementPanel from './TraceManagement';
import RouteManager from './RouteManager';

// Shared browser only; Point, Path and Trace still own their existing Save,
// route sequencing, line segments, map picker, and write permission checks.
export default function UnifiedSpatialManagement({scopeId,initialType='point',initialRecordUid=''}){
  const [selected,setSelected]=useState({type:initialType,uid:initialType==='point'?'':initialRecordUid,serial:0});
  const leaveGuard=useRef(null);
  const registerLeave=useCallback(fn=>{leaveGuard.current=fn;},[]);
  const query=useAsyncResource(traceKey(scopeId,{includeHidden:true}),
    ()=>readTraceData(scopeId,{includeHidden:true}),{
      enabled:TRACE_SCOPES.includes(scopeId),revalidateOnFocus:false,revalidateOnReconnect:false
    });
  const pick=useCallback((type,uid='')=>{
    if(leaveGuard.current&&!leaveGuard.current())return;
    leaveGuard.current=null;
    setSelected(current=>({type,uid,serial:current.serial+1}));
  },[]);
  if(query.error)return <p role="alert" className="scope-status scope-error">{String(query.error.message||query.error)}</p>;
  if(query.isPending||!query.data)return <section className="loc-unified-spatial-manager" aria-busy="true" aria-label="空間定錨管理">
    <div className="scope-culture-record-browser"><h3>空間定錨列表</h3><p className="scope-status" role="status">正在載入空間定錨列表…</p></div>
    <div className="loc-progressive-river-frame"><span>空間資料與地圖</span><div className="loc-progressive-river-axis" aria-hidden="true"/></div>
  </section>;
  const spatial=query.data,route=selected.type==='path'||selected.type==='trace';
  return <SpaceAnchorTree spatial={spatial} scopeId={scopeId}
    value={selected.uid?selected.type+':'+selected.uid:''} onSelect={pick}
    onCreate={type=>pick(type)} className="loc-unified-spatial-manager">
    {route?<RouteManager key={scopeId+':'+selected.type+':'+selected.uid+':'+selected.serial}
      scopeId={scopeId} mode="all" treeMode selectedRecordUid={selected.uid}
      initialType={selected.type} spatialData={spatial} reloadSpatial={()=>query.mutate()}
      onRegisterLeave={registerLeave} onRemoved={()=>setSelected(old=>({type:'point',uid:'',serial:old.serial+1}))}/>:<TraceManagementPanel
      key={scopeId+':point:'+selected.uid+':'+selected.serial}
      scopeId={scopeId} mode="lucus" embedded selectedUid={selected.uid}
      spatialData={spatial} reloadSpatial={()=>query.mutate()} onRegisterLeave={registerLeave}/>}
  </SpaceAnchorTree>;
}
