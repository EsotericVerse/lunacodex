'use client';

import {useMemo,useState} from 'react';
import dynamic from 'next/dynamic';
import {FeaturePage} from '../ui';
import {useAsyncResource} from '../../../packages/zenstack/client-queries';
import {buildTraceTerritoryRouteModel} from './trace/trace-territory-overlay.mjs';
import {readTraceMapIndex,readCurrentTraceLucus,traceMapIndexKey} from './trace/trace-data';

// LOC combines its published annual article terrain and saved Trace/Path
// hierarchy in one MapLibre instance. The heavy terrain panel remains lazy.
const TraceTerritoryPanel=dynamic(()=>import('./trace/TraceTerritoryPanel'),{
  ssr:false,
  loading:()=> <p className="scope-status" role="status">正在準備年度文章地形與路徑圖…</p>
});

export default function LocTracePreview(){
  const [selectedTraceKey,setSelectedTraceKey]=useState('');
  const [selectedPathKey,setSelectedPathKey]=useState('');
  const index=useAsyncResource({
    queryKey:traceMapIndexKey('loc'),
    queryFn:()=>readTraceMapIndex('loc'),
    revalidateIfStale:false,revalidateOnFocus:false,revalidateOnReconnect:false
  });
  const routeModel=useMemo(()=>buildTraceTerritoryRouteModel(
    index.data||[],selectedTraceKey,selectedPathKey
  ),[index.data,selectedTraceKey,selectedPathKey]);
  const routePoints=useAsyncResource({
    queryKey:['loc-trace-territory-route-points-v1',
      routeModel.selected?.source_scope||'',routeModel.selected?.uid||'',
      routeModel.memberUids.join(',')],
    enabled:Boolean(routeModel.selected&&routeModel.memberUids.length),
    queryFn:()=>readCurrentTraceLucus(
      routeModel.selected.source_scope,routeModel.memberUids
    ),
    revalidateIfStale:false,revalidateOnFocus:false,revalidateOnReconnect:false
  });
  const routeControls=<div className="loc-trace-territory-route-controls"
    role="group" aria-label="痕跡圖與路徑圖選擇">
    <label>痕跡圖
      <select className="scope-select" aria-label="痕跡圖選擇"
        value={routeModel.activeTraceKey}
        disabled={index.isPending||!routeModel.traceOptions.length}
        onChange={event=>{
          setSelectedTraceKey(event.target.value);
          setSelectedPathKey('');
        }}>
        {routeModel.traceOptions.length?routeModel.traceOptions.map(row=>
          <option key={row.key} value={row.key}>{row.label}</option>
        ):<option value="">目前沒有公開痕跡圖</option>}
      </select>
    </label>
    <label>路徑圖
      <select className="scope-select" aria-label="所屬路徑圖選擇"
        value={routeModel.activePath
          ?routeModel.activePath.source_scope+':'+routeModel.activePath.uid
          :routeModel.currentGroup?'__overview__'
            :routeModel.selected
              ?routeModel.selected.source_scope+':'+routeModel.selected.uid:''}
        disabled={index.isPending||!routeModel.selected}
        onChange={event=>setSelectedPathKey(
          event.target.value==='__overview__'?'':event.target.value
        )}>
        {routeModel.currentGroup?<option value="__overview__">整個痕跡圖</option>:null}
        {routeModel.routeOptions.map(row=><option
          key={row.source_scope+':'+row.uid}
          value={row.source_scope+':'+row.uid}>
          {row.title||row.uid}
        </option>)}
        {!routeModel.routeOptions.length&&!routeModel.currentGroup&&routeModel.selected
          ?<option value={routeModel.selected.source_scope+':'+routeModel.selected.uid}>
            {routeModel.selected.title||routeModel.selected.uid}
          </option>:null}
      </select>
    </label>
    {index.isPending?<span className="scope-status" role="status">正在取得已公開的痕跡圖與路徑圖…</span>:null}
    {index.error?<span className="scope-status scope-error" role="alert">
      路徑索引暫時無法載入：{String(index.error.message||index.error)}
    </span>:null}
    {!index.isPending&&!index.error&&!routeModel.selected
      ?<span className="scope-status">目前沒有公開的痕跡圖或路徑圖；年度文章地形仍可使用。</span>:null}
    {routeModel.selected&&routeModel.memberUids.length&&routePoints.isPending
      ?<span className="scope-status" role="status">正在讀取所選路徑的空間定錨點…</span>:null}
    {routePoints.error?<span className="scope-status scope-error" role="alert">
      路徑座標暫時無法載入：{String(routePoints.error.message||routePoints.error)}
    </span>:null}
    {routeModel.selected&&!routeModel.memberUids.length
      ?<span className="scope-status">此圖尚未連結可顯示的空間定錨點。</span>:null}
  </div>;

  return <FeaturePage featureId="trace">
    <section className="loc-card scope-feature-card scope-feature-card-wide">
      <h2>年度文章地形與痕跡路徑</h2>
      <p className="scope-status">
        年度文章、地點與日期沿用同一張地形圖；痕跡圖依既有 Trace → Path 關係選取，
        不以地理距離推測父子關係。選取據點後可繼續查看日期與文章。
      </p>
      <TraceTerritoryPanel scopeId="loc" routeOverlay={{
        maps:routeModel.maps,
        points:routePoints.data||[],
        selectedRouteUid:routeModel.selected?.uid||'',
        controls:routeControls
      }}/>
    </section>
  </FeaturePage>;
}
