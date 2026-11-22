'use client';

import {useMemo,useState} from 'react';
import dynamic from 'next/dynamic';
import {FeaturePage} from '../ui';
import ScopeLink from '../ScopeLink';
import {featureNavigationHref} from '../routing/feature-navigation';
import {useAsyncResource} from '../../../packages/zenstack/client-queries';
import {traceRouteHierarchy} from './trace/trace-route-hierarchy.mjs';
import {
  readTraceMapIndex,readCurrentTraceAnchors,traceMapIndexKey,traceMemberUids
} from './trace/trace-data';

// LOC is a lightweight cross-Scope route/trace PREVIEW, not a second
// annual article map or an all-places database browser. Keep MapLibre out
// of the initial JS chunk until actual published routes are available.
const TraceMap=dynamic(()=>import('./trace/TraceMap'),{
  ssr:false,loading:()=> <p className="scope-status" role="status">正在載入痕跡地圖…</p>
});
const routeKey=row=>String(row.source_scope||'')+':'+String(row.uid||'');

export default function LocTracePreview(){
  const [selectedTraceKey,setSelectedTraceKey]=useState('');
  const [selectedPathKey,setSelectedPathKey]=useState('');
  // The LOC index delegates to published member Scopes only. It reads
  // path/trace definitions from their own Scope storage, never LOC's Point table.
  const index=useAsyncResource({
    queryKey:traceMapIndexKey('loc'),
    queryFn:()=>readTraceMapIndex('loc'),
    revalidateIfStale:false,revalidateOnFocus:false,revalidateOnReconnect:false
  });
  const routes=useMemo(()=>(index.data||[]).filter(row=>
    ['path','trace'].includes(row.trace_type)&&row.source_scope&&row.uid),
    [index.data]);
  // Hierarchy comes from persisted Trace.attr.path links, never location
  // proximity. First select a Trace, then a Path belonging to that Trace.
  const hierarchy=useMemo(()=>traceRouteHierarchy(routes),[routes]);
  const traceOptions=useMemo(()=>[
    ...hierarchy.groups.map(group=>({key:routeKey(group.trace),label:group.trace.source_scope+' · '+group.trace.title})),
    ...(hierarchy.orphans.length?[{key:'__standalone__',label:'未歸屬路線圖'}]:[])
  ],[hierarchy]);
  const activeTraceKey=traceOptions.some(row=>row.key===selectedTraceKey)
    ?selectedTraceKey:traceOptions[0]?.key||'';
  const currentGroup=hierarchy.groups.find(group=>routeKey(group.trace)===activeTraceKey)||null;
  const routeOptions=currentGroup?.paths||hierarchy.orphans;
  const activePath=routeOptions.find(row=>routeKey(row)===selectedPathKey)||null;
  const selected=activePath||(currentGroup?.trace||routeOptions[0]||null);
  const referencedRoutes=currentGroup?.trace===selected?currentGroup.paths:[];
  const memberIds=useMemo(()=>[...new Set([
    ...traceMemberUids(selected),...referencedRoutes.flatMap(traceMemberUids)
  ])],[selected,referencedRoutes]);
  // Read point coordinates only for the chosen saved route/trace so its
  // lines can be drawn. Never scan places or calculate article density.
  const points=useAsyncResource({
    queryKey:['loc-trace-selected-route-v1',selected?.source_scope||'',selected?.uid||'',memberIds.join(',')],
    enabled:Boolean(selected&&memberIds.length),
    queryFn:()=>readCurrentTraceAnchors(selected.source_scope,memberIds),
    revalidateIfStale:false,revalidateOnFocus:false,revalidateOnReconnect:false
  });
  const spatial=useMemo(()=>selected?{
    anchors:points.data||[],maps:[selected,...referencedRoutes]
  }:null,[selected,points.data,referencedRoutes]);
  return <FeaturePage featureId="trace">
    <section className="loc-card scope-feature-card scope-feature-card-wide">
      <h2>痕跡與路線圖</h2>
      <p className="scope-status">LOC 僅預覽各 Scope 已公開的痕跡圖與路線圖，不載入年度文章或獨立地點列表。完整資料請前往所屬 Scope。</p>
      {index.isPending?<p className="scope-status" role="status">正在取得各 Scope 路線與痕跡…</p>:null}
      {index.error?<p className="scope-status scope-error" role="alert">{String(index.error.message||index.error)}</p>:null}
      {!index.isPending&&!index.error&&!routes.length?
        <p className="scope-status">目前沒有已開放的痕跡圖或路線圖。</p>:null}
      {routes.length?<div className="scope-stat-controls">
        <label>痕跡圖
          <select className="scope-select" aria-label="痕跡圖選擇"
            value={activeTraceKey} onChange={event=>{
              setSelectedTraceKey(event.target.value);
              setSelectedPathKey('');
            }}>
            {traceOptions.map(row=><option key={row.key} value={row.key}>{row.label}</option>)}
          </select>
        </label>
        <label>路徑圖
          <select className="scope-select" aria-label="所屬路徑圖選擇"
            value={activePath?routeKey(activePath):'__overview__'}
            onChange={event=>setSelectedPathKey(event.target.value==='__overview__'?'':event.target.value)}>
            {currentGroup?<option value="__overview__">整個痕跡圖</option>:null}
            {routeOptions.map(row=><option key={routeKey(row)} value={routeKey(row)}>
              {row.title||row.uid}
            </option>)}
          </select>
        </label>
        {selected?<ScopeLink href={featureNavigationHref(selected.source_scope,'trace')}>
          前往 {selected.source_scope} 查看完整痕跡
        </ScopeLink>:null}
      </div>:null}
      {selected&&points.isPending?<p className="scope-status" role="status">正在讀取所選路線的座標…</p>:null}
      {points.error?<p className="scope-status scope-error" role="alert">
        {String(points.error.message||points.error)}
      </p>:null}
      {selected?<TraceMap publicTrace routeOnly spatialData={spatial}
        selectedRouteUid={selected.uid} hideRoutePicker showAnchorSearch={false}/>:null}
    </section>
  </FeaturePage>;
}
