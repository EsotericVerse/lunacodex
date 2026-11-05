'use client';

import {useEffect,useMemo,useState} from 'react';
import {useSearchParams} from 'next/navigation';
import dynamic from 'next/dynamic';
import {FeaturePage} from '../ui';
import UiText,{useUiText} from '../../i18n/UiText';
import {useUiSection} from '../../i18n/ui-locale';
import {registerDefaultSection} from '../../i18n/ui-copy';
import traceZh from '../../i18n/sections/uiExtra.traceUI.zh_tw.js';
registerDefaultSection('uiExtra.traceUI',traceZh);
const TEXT='uiExtra.traceUI.';
import {useAsyncResource} from '../../loc/use-async-resource';
import useLocFeatureSettings from '../../loc/use-loc-feature-settings';
import {traceWindow} from './trace/trace-panel-filters.mjs';
import {publicTraceMapChoices} from './trace/trace-map-choices.mjs';
import {pickTraceDemoStop,traceDemoRoute} from './trace/trace-demo-route.mjs';
import {
  readDefaultTraceRoute,setDefaultTraceRoute,chooseDefaultTraceRoute,
  TRACE_DEFAULT_ROUTE_CHANGED
} from './trace/trace-route-preference.mjs';
import {
  TRACE_SCOPES,traceMapIndexKey,traceCurrentKey,traceMemberUids,
  readTraceMapIndex,readCurrentTraceAnchors
} from './trace/trace-data';

// A Current route loads only its members. Without a saved route, show the
// Scope's saved anchors automatically.
const TraceMap=dynamic(()=>import('./trace/TraceMap'),{
  ssr:false,
  loading:()=> <p className="scope-status" role="status"><UiText id="uiExtra.traceUI.loadingMap"/></p>
});
const TracePlaceResults=dynamic(()=>import('./trace/TracePlaceResults'),{
  loading:()=> <p className="scope-status"><UiText id="uiExtra.traceUI.loadingPlaceResults"/></p>
});

export default function Trace({scopeId='loc'}){
  useUiSection('uiExtra.traceUI');
  const translate=useUiText();
  const t=key=>translate(TEXT+key);
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
  // A display preference must never turn the homepage into an unbounded
  // point scan. The selector starts with saved path/trace definitions only.
  const maps=allMapChoices;
  const mapChoiceKey=row=>isLoc?row.source_scope+':'+row.uid:row.uid;
  const currentMap=useMemo(()=>isLoc
    ?maps.find(row=>row.source_scope+':'+row.uid===currentTraceChoice)
      ||maps.find(row=>row.trace_type==='path')||null
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
  // Never auto-select the legacy All Anchors mode from stored preferences.
  // The initial viewport is only the selected saved route.
  const chooseCurrentTrace=value=>{
    setSelectedPlace(null);
    if(isLoc){setCurrentTraceChoice(value);return;}
    if(setDefaultTraceRoute(scopeId,value))setCurrentTraceChoice(value);
  };
  const linkedRoutes=useMemo(()=>currentMap?.trace_type==='trace'
    ?allMaps.filter(row=>row.source_scope===currentMap.source_scope&&row.trace_type==='path'
      &&(currentMap.route_list?.routes||[]).includes(row.uid))
    :[],[currentMap,allMaps]);
  const members=useMemo(()=>currentMap
    ?[...new Set([...traceMemberUids(currentMap),...linkedRoutes.flatMap(traceMemberUids)])]:[],
    [currentMap,linkedRoutes]);
  useEffect(()=>{setDemoStopIds([]);},[periodScopeId,currentMap?.uid]);

  // Phase 2: cache the current route's 2–80 sites by its membership revision.
  // Repeated visits have their own timestamps; a multi-day trip does not imply
  // that any one stop was occupied for its entire duration.
  const anchorsQuery=useAsyncResource({
    queryKey:currentMap
      ?traceCurrentKey(periodScopeId,{...currentMap,anchor_list:members},{nativeOnly:periodScopeId==='loc'})
      :['trace-no-selected-route',periodScopeId],
    enabled:supported&&routeListOpen&&traceIndex.data!==undefined&&Boolean(currentMap),
    queryFn:()=>readCurrentTraceAnchors(periodScopeId,members,
      {nativeOnly:periodScopeId==='loc'}),
    revalidateIfStale:false,revalidateOnFocus:false,revalidateOnReconnect:false
  });
  const spatialData=useMemo(()=>{
    if(!routeListOpen||traceIndex.data===undefined)return null;
    if(!currentMap)return {anchors:[],maps:[]};
    if(anchorsQuery.data===undefined)return null;
    return {anchors:anchorsQuery.data,maps:[currentMap,...linkedRoutes]};
  },[routeListOpen,traceIndex.data,anchorsQuery.data,currentMap,linkedRoutes]);

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
        <span>{t("currentMaps")}</span>
        <select className="scope-select"
          value={currentMap?mapChoiceKey(currentMap):''}
          onChange={event=>chooseCurrentTrace(event.target.value)}
          disabled={traceIndex.isPending||Boolean(traceIndex.error)||!maps.length}>
          {isLoc
            ?(maps.length?maps.map(map=><option key={mapChoiceKey(map)} value={mapChoiceKey(map)}>
              {map.source_scope==='lrunes'?t('runes'):t('author')} · {map.title}
            </option>):<option value="">{t("noMaps")}</option>)
            :maps.map(map=><option key={mapChoiceKey(map)} value={mapChoiceKey(map)}>
              {map.title}（{map.trace_type==='trace'?t('traceMap'):t('routeMap')}）
            </option>)}

        </select>
      </label>:null}
      {!isLoc?<details className="loc-trace-more-controls">
        <summary>{t("more")}</summary>
        <div className="loc-trace-more-actions">
      {supported?<button type="button" className="loc-button" aria-pressed={twoPointDemo}
        onClick={()=>{setTwoPointDemo(value=>!value);setDemoStopIds([]);setSelectedPlace(null);}}>
        {twoPointDemo?t('endDemo'):t('startDemo')}
      </button>:null}
        </div>
      </details>:null}
    </div>
    {supported&&traceIndex.isPending?<p className="scope-status" role="status">{t("loadingMaps")}</p>:null}
    {supported&&traceIndex.error?<p className="scope-status scope-error" role="alert">
      {t("mapsError")}{String(traceIndex.error.message||traceIndex.error)}
    </p>:null}
    {supported&&anchorsQuery.isPending?<p className="scope-status" role="status">{t("loadingAnchors")}</p>:null}
    {supported&&anchorsQuery.error?<p className="scope-status scope-error" role="alert">
      {t("anchorsError")}{String(anchorsQuery.error.message||anchorsQuery.error)}
    </p>:null}
    {supported&&!traceIndex.isPending&&!traceIndex.error&&!maps.length?<p className="scope-status">
      {t('noMapsOrAnchors')}
    </p>:null}

    {twoPointDemo?<div className="loc-trace-demo-message" role="group" aria-label={t("demoTitle")}>
      <p className="scope-status" role="status" aria-live="polite">
        {demoRoute?t('selectedTwo')+demoStopIds.map(uid=>spatialData?.anchors.find(row=>row.uid===uid)?.title||uid).join(' → ')+t('demoPreviewOnly'):
          demoStopIds.length===1?t('selectedStart')+(spatialData?.anchors.find(row=>row.uid===demoStopIds[0])?.title||demoStopIds[0])+t('selectSecond'):
          t('demoHelp')}
      </p>
      <button className="loc-button" type="button" onClick={()=>setDemoStopIds([])} disabled={!demoStopIds.length}>
        {t("clearDemo")}
      </button>
    </div>:null}
  </>;
  return <FeaturePage featureId="trace">
    <TraceMap publicTrace floatingControls={floatingControls} spatialData={demoSpatialData} hideRoutePicker
      selectedRouteUid={twoPointDemo?(demoRoute?.uid||''):(currentMap?.uid||'')}
      showAnchorSearch={!isLoc} onAnchorSelect={chooseMapAnchor}>
      {reportPlace?<div className="loc-trace-float-report" role="dialog" aria-modal="false"
        aria-label={t('placeContent')+reportPlace.title}>
        <div className="loc-trace-float-heading">
          <strong>{reportPlace.title}</strong>
          <button type="button" className="loc-button" aria-label={t("closePlace")}
            onClick={()=>{setSelectedPlace(null);setReportTab(null);}}>×</button>
        </div>
        <div className="loc-trace-float-tabs" role="group" aria-label={t("placeMode")}>
          {[{value:'articles',label:t('articles')},{value:'timeline',label:t('timeline')},{value:'statistics',label:t('charts')}].map(item=>
            <button type="button" key={item.value} className="loc-button"
              aria-pressed={reportTab===item.value}
              onClick={()=>setReportTab(item.value)}>{item.label}</button>)}
        </div>
        {reportTab?<details className="loc-trace-float-settings">
          <summary>{t("reportSettings")}</summary>
      <div className="loc-trace-report-settings">
        <label>{t("time")}
          <select className="scope-select" value={timeWindow} onChange={event=>setTimeWindow(event.target.value)}>
            <option value="3m">{t("lastThreeMonths")}</option>
            <option value="12m">{t("lastYear")}</option>
            <option value="all">{t("allTime")}</option>
            <option value="custom">{t("custom")}</option>
          </select>
        </label>
        {timeWindow==='custom'?<>
          <label>{t("startDate")}<input type="date" value={customStart} onChange={event=>setCustomStart(event.target.value)}/></label>
          <label>{t("endDate")}<input type="date" value={customEnd} onChange={event=>setCustomEnd(event.target.value)}/></label>
        </>:null}
        <form onSubmit={event=>{event.preventDefault();setSourceName(sourceDraft.trim());}}>
          <label>{t("sourceCategory")}
            <input type="search" value={sourceDraft} onChange={event=>setSourceDraft(event.target.value)}
              placeholder={t("sourcePlaceholder")}/>
          </label>
          <button type="submit" className="loc-button">{t("applySource")}</button>
          {sourceName?<button type="button" className="loc-button"
            onClick={()=>{setSourceName('');setSourceDraft('');}}>{t("clearSource")}</button>:null}
        </form>
        <label>{t("mediaType")}
          <select className="scope-select" value={mediaType}
            onChange={event=>setMediaType(event.target.value)}>
            <option value="">{t("allMedia")}</option>
            <option value="音樂">{t("music")}</option>
            <option value="圖片">{t("image")}</option>
            <option value="影片">{t("video")}</option>
            <option value="rune">{t("runeDraw")}</option>
          </select>
        </label>
        <p className="scope-status">{t("settingsIntro")} {timeWindow==='3m'?t('lastThreeMonths'):timeWindow==='all'?t('allTime'):t('currentTime')}。</p>
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
