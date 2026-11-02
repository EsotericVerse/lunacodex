'use client';

import {useEffect,useMemo,useState} from 'react';
import {useSearchParams} from 'next/navigation';
import dynamic from 'next/dynamic';
import {FeaturePage} from '../ui';
import {useAsyncResource} from '../../loc/use-async-resource';
import useLocFeatureSettings from '../../loc/use-loc-feature-settings';
import {traceHomeMapChoices} from '../../loc/loc-feature-preferences.mjs';
import {traceWindow} from './trace/trace-panel-filters.mjs';
import {publicTraceMapChoices} from './trace/trace-map-choices.mjs';
import {pickTraceDemoStop,traceDemoRoute} from './trace/trace-demo-route.mjs';
import {
  readDefaultTraceRoute,setDefaultTraceRoute,chooseDefaultTraceRoute,
  TRACE_DEFAULT_ROUTE_CHANGED
} from './trace/trace-route-preference.mjs';
import {
  TRACE_SCOPES,traceMapIndexKey,traceCurrentKey,traceAllAnchorsKey,traceMemberUids,
  readTraceMapIndex,readCurrentTraceAnchors,readAllTraceAnchors
} from './trace/trace-data';

// A Current route loads only its members. Without a saved route, show the
// Scope's saved anchors automatically.
const TraceMap=dynamic(()=>import('./trace/TraceMap'),{
  ssr:false,
  loading:()=> <p className="scope-status" role="status">正在載入痕跡地圖…</p>
});
const TracePlaceResults=dynamic(()=>import('./trace/TracePlaceResults'),{
  loading:()=> <p className="scope-status">正在準備地點作品列表…</p>
});

export default function Trace({scopeId='loc'}){
  const supported=TRACE_SCOPES.includes(scopeId);
  const {settings:userSettings,active:userActive}=useLocFeatureSettings('trace');
  const [selectedPlace,setSelectedPlace]=useState(null);
  const routeParams=useSearchParams();
  const selectedPlaceUid=String(routeParams?.get('place')||'').trim();
  const selectedMapUid=String(routeParams?.get('map')||'').trim();
  const [twoPointDemo,setTwoPointDemo]=useState(false);
  const [demoStopIds,setDemoStopIds]=useState([]);
  // LOC shows the cross-Scope union of published Trace groups; routes are children.
  const isLoc=scopeId==='loc';
  const [routeListOpen]=useState(true);
  const [currentTraceChoice,setCurrentTraceChoice]=useState('auto');
  const [reportTab,setReportTab]=useState(null);
  // Historical Frames should not default to hiding older check-in articles.
  const [timeWindow,setTimeWindow]=useState('all');
  const [customStart,setCustomStart]=useState('');
  const [customEnd,setCustomEnd]=useState('');
  const [sourceDraft,setSourceDraft]=useState('');
  const [sourceName,setSourceName]=useState('');
  const [mediaType,setMediaType]=useState('');
  const dateRange=useMemo(()=>traceWindow(timeWindow,new Date(),
    {start:customStart,end:customEnd}),[timeWindow,customStart,customEnd]);
  const choosePlace=anchor=>{
    if(!anchor?.uid)return;
    // The map's selected anchor is a Frame drill-down, not a Search navigation.
    setReportTab(null);
    setSelectedPlace(anchor);
  };


  // Phase 1: load the light index, never all historical check-ins at startup.
  const traceIndex=useAsyncResource({
    queryKey:traceMapIndexKey(scopeId),
    enabled:supported&&routeListOpen,
    queryFn:()=>readTraceMapIndex(scopeId),
    revalidateIfStale:false,revalidateOnFocus:false,revalidateOnReconnect:false
  });
  const allMaps=traceIndex.data||[];
  const allMapChoices=publicTraceMapChoices(allMaps,scopeId);
  const maps=userActive&&!selectedMapUid
    ?traceHomeMapChoices(allMapChoices,userSettings.display):allMapChoices;
  const mapChoiceKey=row=>isLoc?row.source_scope+':'+row.uid:row.uid;
  const currentMap=useMemo(()=>isLoc
    ?maps.find(row=>row.source_scope+':'+row.uid===currentTraceChoice)||maps.find(row=>row.trace_type==='trace')||maps[0]||null
    :chooseDefaultTraceRoute(maps,scopeId,currentTraceChoice),
    [allMaps,scopeId,currentTraceChoice,isLoc]);
  const periodScopeId=isLoc?(currentMap?.source_scope||'loc'):scopeId;
  const deepLinkedPlace=useAsyncResource({
    queryKey:['trace-open-place',periodScopeId,selectedPlaceUid],
    enabled:supported&&Boolean(selectedPlaceUid)&&TRACE_SCOPES.includes(periodScopeId)&&periodScopeId!=='loc',
    queryFn:async()=>(await readCurrentTraceAnchors(periodScopeId,[selectedPlaceUid]))[0]||null,
    revalidateOnFocus:false,revalidateOnReconnect:false
  });
  useEffect(()=>{
    if(!deepLinkedPlace.data?.uid)return;
    setSelectedPlace(deepLinkedPlace.data);
    setReportTab('articles');
  },[deepLinkedPlace.data?.uid]);
  // Reuse the route preference from the existing management editor. "All"
  // is a temporary view, not a persisted default or a second preference key.
  useEffect(()=>{
    const reloadDefault=()=>{
      setCurrentTraceChoice(isLoc?'auto':readDefaultTraceRoute(scopeId)||'auto');
      setSelectedPlace(null);
    };
    reloadDefault();
    if(!isLoc)window.addEventListener(TRACE_DEFAULT_ROUTE_CHANGED,reloadDefault);
    return()=>window.removeEventListener(TRACE_DEFAULT_ROUTE_CHANGED,reloadDefault);
  },[scopeId,isLoc]);
  useEffect(()=>{
    if(!selectedMapUid||!allMaps.length)return;
    const found=maps.find(row=>String(row.uid)===selectedMapUid);
    if(found)setCurrentTraceChoice(isLoc?found.source_scope+':'+found.uid:found.uid);
  },[selectedMapUid,allMaps,scopeId,isLoc]);
  useEffect(()=>{
    if(userActive&&!selectedMapUid)
      setCurrentTraceChoice(userSettings.display==='anchor'?'all':'auto');
  },[scopeId,userActive,userSettings.display,selectedMapUid]);
  const chooseCurrentTrace=value=>{
    setSelectedPlace(null);
    if(isLoc){setCurrentTraceChoice(value);return;}
    if(value==='all'){setCurrentTraceChoice('all');return;}
    if(setDefaultTraceRoute(scopeId,value))setCurrentTraceChoice(value);
  };
  const showingAll=currentTraceChoice==='all'||(!currentMap&&!maps.length);
  const linkedRoutes=useMemo(()=>currentMap?.trace_type==='trace'
    ?allMaps.filter(row=>row.source_scope===currentMap.source_scope&&row.trace_type==='path'
      &&(currentMap.route_list?.routes||[]).includes(row.uid))
    :[],[currentMap,allMaps]);
  const members=useMemo(()=>currentMap
    ?[...new Set([...traceMemberUids(currentMap),...linkedRoutes.flatMap(traceMemberUids)])]:[],
    [currentMap,linkedRoutes]);
  useEffect(()=>{setDemoStopIds([]);},[periodScopeId,currentMap?.uid,showingAll]);

  // Phase 2: cache the current route's 2–80 sites by its membership revision.
  // Repeated visits have their own timestamps; a multi-day trip does not imply
  // that any one stop was occupied for its entire duration.
  const anchorsQuery=useAsyncResource({
    queryKey:currentMap
      ?traceCurrentKey(periodScopeId,{...currentMap,anchor_list:members},{nativeOnly:periodScopeId==='loc'})
      :traceAllAnchorsKey(periodScopeId,{nativeOnly:periodScopeId==='loc'}),
    enabled:supported&&routeListOpen&&traceIndex.data!==undefined&&(Boolean(currentMap)||showingAll),
    queryFn:()=>currentMap
      ?readCurrentTraceAnchors(periodScopeId,members,
          {nativeOnly:periodScopeId==='loc'})
      :readAllTraceAnchors(periodScopeId,{nativeOnly:periodScopeId==='loc'}),
    revalidateIfStale:false,revalidateOnFocus:false,revalidateOnReconnect:false
  });
  const spatialData=useMemo(()=>{
    if(!routeListOpen||traceIndex.data===undefined)return null;
    if(!showingAll&&!currentMap)return {anchors:[],maps:[]};
    if(anchorsQuery.data===undefined)return null;
    return {anchors:anchorsQuery.data,
      maps:showingAll?maps:[currentMap,...linkedRoutes]};
  },[routeListOpen,traceIndex.data,anchorsQuery.data,currentMap,showingAll,linkedRoutes]);

  const demoRoute=useMemo(()=>traceDemoRoute(demoStopIds,spatialData?.anchors||[],periodScopeId),
    [demoStopIds,spatialData?.anchors,periodScopeId]);
  const linkedSpatialData=useMemo(()=>{
    const anchor=deepLinkedPlace.data;
    if(!spatialData||!anchor?.uid||spatialData.anchors.some(item=>item.uid===anchor.uid))return spatialData;
    return {...spatialData,anchors:[...spatialData.anchors,anchor]};
  },[spatialData,deepLinkedPlace.data]);
  const demoSpatialData=useMemo(()=>twoPointDemo&&linkedSpatialData
    ?{anchors:linkedSpatialData.anchors,maps:demoRoute?[demoRoute]:[]}
    :linkedSpatialData,[twoPointDemo,linkedSpatialData,demoRoute]);
  const chooseMapAnchor=anchor=>{
    if(!twoPointDemo){choosePlace(anchor);return;}
    setDemoStopIds(ids=>pickTraceDemoStop(ids,anchor,periodScopeId));
  };
  const selectedAvailable=selectedPlace&&(
    selectedPlace.uid===deepLinkedPlace.data?.uid
    ||(selectedPlace.trace_type!=='space_anchor'
      ?spatialData?.maps.some(row=>row.uid===selectedPlace.uid&&row.source_scope===selectedPlace.source_scope)
      :spatialData?.anchors.some(row=>row.uid===selectedPlace.uid&&row.source_scope===selectedPlace.source_scope))
  );
  const reportPlace=twoPointDemo?null:(selectedAvailable?selectedPlace:null);

  const floatingControls=<>
    <div className="loc-trace-float-choices">
      {supported&&routeListOpen?<label>
        <span>目前顯示（痕跡圖聯集）</span>
        <select className="scope-select"
          value={showingAll?'all':currentMap?mapChoiceKey(currentMap):''}
          onChange={event=>chooseCurrentTrace(event.target.value)}
          disabled={traceIndex.isPending||Boolean(traceIndex.error)||!maps.length}>
          {isLoc
            ?(maps.length?maps.map(map=><option key={mapChoiceKey(map)} value={mapChoiceKey(map)}>
              {map.source_scope==='lrunes'?'月之符文':'作者作品'} · {map.title}
            </option>):<option value="">目前沒有可顯示的痕跡圖</option>)
            :maps.map(map=><option key={mapChoiceKey(map)} value={mapChoiceKey(map)}>
              {map.title}（{map.trace_type==='trace'?'痕跡圖':'路線圖'}）
            </option>)}

        </select>
      </label>:null}
      {!isLoc?<details className="loc-trace-more-controls">
        <summary>更多操作</summary>
        <div className="loc-trace-more-actions">
      {supported?<button type="button" className="loc-button" aria-pressed={twoPointDemo}
        onClick={()=>{setTwoPointDemo(value=>!value);setDemoStopIds([]);setSelectedPlace(null);}}>
        {twoPointDemo?'結束兩點試玩':'兩點路線試玩（不儲存）'}
      </button>:null}
        </div>
      </details>:null}
    </div>
    {supported&&traceIndex.isPending?<p className="scope-status" role="status">正在載入痕跡列表…</p>:null}
    {supported&&traceIndex.error?<p className="scope-status scope-error" role="alert">
      痕跡列表讀取失敗：{String(traceIndex.error.message||traceIndex.error)}
    </p>:null}
    {supported&&anchorsQuery.isPending?<p className="scope-status" role="status">正在載入目前痕跡的地點…</p>:null}
    {supported&&anchorsQuery.error?<p className="scope-status scope-error" role="alert">
      痕跡錨點讀取失敗：{String(anchorsQuery.error.message||anchorsQuery.error)}
    </p>:null}
    {supported&&!traceIndex.isPending&&!traceIndex.error&&!maps.length&&anchorsQuery.isSuccess?<p className="scope-status">
      {anchorsQuery.data?.length
        ?'尚未建立路線圖或痕跡圖，目前自動顯示全部 '+anchorsQuery.data.length+' 個空間定錨點。'
        :'尚未建立路線圖或痕跡圖，也沒有已儲存的空間定錨點。'}
    </p>:null}

    {twoPointDemo?<div className="loc-trace-demo-message" role="group" aria-label="兩點路線試玩">
      <p className="scope-status" role="status" aria-live="polite">
        {demoRoute?'已選兩點：'+demoStopIds.map(uid=>spatialData?.anchors.find(row=>row.uid===uid)?.title||uid).join(' → ')+'。僅供預覽，不會儲存。':
          demoStopIds.length===1?'已選起點：'+(spatialData?.anchors.find(row=>row.uid===demoStopIds[0])?.title||demoStopIds[0])+'。請再點地圖上的第二個定錨點。':
          '點地圖上兩個已有座標的定錨點，即可預覽兩點連線。一般訪客不能儲存。'}
      </p>
      <button className="loc-button" type="button" onClick={()=>setDemoStopIds([])} disabled={!demoStopIds.length}>
        清除並重新選兩點
      </button>
    </div>:null}
  </>;
  return <FeaturePage featureId="trace">
    <TraceMap publicTrace floatingControls={floatingControls} spatialData={demoSpatialData} hideRoutePicker
      selectedRouteUid={twoPointDemo?(demoRoute?.uid||''):(currentMap?.uid||'')}
      showAnchorSearch={!isLoc} onAnchorSelect={chooseMapAnchor}>
      {reportPlace?<div className="loc-trace-float-report" role="dialog" aria-modal="false"
        aria-label={'地點內容：'+reportPlace.title}>
        <div className="loc-trace-float-heading">
          <strong>{reportPlace.title}</strong>
          <button type="button" className="loc-button" aria-label="關閉地點內容"
            onClick={()=>{setSelectedPlace(null);setReportTab(null);}}>×</button>
        </div>
        <div className="loc-trace-float-tabs" role="group" aria-label="地點呈現模式">
          {[{value:'articles',label:'文章列表'},{value:'timeline',label:'時間長河'},{value:'statistics',label:'統計圖'}].map(item=>
            <button type="button" key={item.value} className="loc-button"
              aria-pressed={reportTab===item.value}
              onClick={()=>setReportTab(item.value)}>{item.label}</button>)}
        </div>
        {reportTab?<details className="loc-trace-float-settings">
          <summary>文章與圖表設定</summary>
      <div className="loc-trace-report-settings">
        <label>時間
          <select className="scope-select" value={timeWindow} onChange={event=>setTimeWindow(event.target.value)}>
            <option value="3m">最近三個月</option>
            <option value="12m">最近一年</option>
            <option value="all">全部時間（預設）</option>
            <option value="custom">自訂日期</option>
          </select>
        </label>
        {timeWindow==='custom'?<>
          <label>開始日期<input type="date" value={customStart} onChange={event=>setCustomStart(event.target.value)}/></label>
          <label>結束日期<input type="date" value={customEnd} onChange={event=>setCustomEnd(event.target.value)}/></label>
        </>:null}
        <form onSubmit={event=>{event.preventDefault();setSourceName(sourceDraft.trim());}}>
          <label>作品來源／分類
            <input type="search" value={sourceDraft} onChange={event=>setSourceDraft(event.target.value)}
              placeholder="例如 Threads（留空＝全部）"/>
          </label>
          <button type="submit" className="loc-button">套用來源</button>
          {sourceName?<button type="button" className="loc-button"
            onClick={()=>{setSourceName('');setSourceDraft('');}}>清除來源</button>:null}
        </form>
        <label>媒體類型
          <select className="scope-select" value={mediaType}
            onChange={event=>setMediaType(event.target.value)}>
            <option value="">全部媒體</option>
            <option value="音樂">音樂</option>
            <option value="圖片">圖片</option>
            <option value="影片">影片</option>
            <option value="rune">抽牌結果（runes）</option>
          </select>
        </label>
        <p className="scope-status">來源對應作品的 site（例如 Threads）；媒體類型對應 galaxy_media.type。兩者可交叉篩選，三種模式共用 {timeWindow==='3m'?'最近三個月':timeWindow==='all'?'全部時間':'目前設定時間'}。</p>
        </div>
        </details>:null}
        {reportTab?<TracePlaceResults key={reportPlace.source_scope+':'+reportPlace.uid} place={reportPlace}
          anchors={spatialData?.anchors||[]} maps={spatialData?.maps||[]} scopeId={periodScopeId}
          tab={reportTab} sourceName={sourceName} mediaType={mediaType} dateRange={dateRange}
          timeMode={userActive?userSettings.time:'none'} defaultSort={userActive?userSettings.sort:'desc'}/>:null}

      </div>:null}
    </TraceMap>
  </FeaturePage>;
}
