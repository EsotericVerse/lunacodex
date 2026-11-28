'use client';
import {useEffect,useMemo,useState} from 'react';
import dynamic from 'next/dynamic';
import {useRouter} from 'next/navigation';
import {useAsyncResource} from '../../../../packages/zenstack/client-queries';
import {UI_COPY} from '../../../i18n/ui-copy';
import {useUiCopy,useUiSection} from '../../../i18n/ui-locale';
import UiText,{useUiText} from '../../../i18n/UiText';
import {defaultScopeData} from '../../../loc/scope/scope-data';
import {featureNavigationHref} from '../../routing/feature-navigation';
import {featureDataErrorMessage} from '../../feature-data-state';
import {availableStatisticIntents,STATISTIC_INTENTS,statisticsZoomWindow} from './statistics-time-zoom.mjs';
import {DEFAULT_YEAR_WINDOW} from '../../../loc/preferences/default-year-window.mjs';
import StatisticsDetails from './StatisticsDetails';
import StatisticsDashboardKpis from './StatisticsDashboardKpis';
const StatisticsMultiChart=dynamic(()=>import('./StatisticsMultiChart'),{loading:()=>null});

const StatisticsInsightsPanel=dynamic(()=>import('./StatisticsInsightsPanel'),{loading:()=>null});
const LocMemberIntersection=dynamic(()=>import('./LocMemberIntersection'),{loading:()=>null});

export default function ScopeGroupStatistics({taipeiDateKey,trendBucket,loadGalaxyStatistics,initialData=null}){
  useUiSection('statistics');
  useUiSection('uiExtra.statisticsUI');
  useUiSection('uiExtra.statisticsView');
  const UI_COPY=useUiCopy();
  const t=useUiText();
  const router=useRouter();
  const [zoomLevel,setZoomLevel]=useState(0);
  const [selectedPeriodKey,setSelectedPeriodKey]=useState('');
  const [chartIntent,setChartIntent]=useState('trend');
  // Persist intersection selections while the range-specific query remounts.
  const [memberLaneCount,setMemberLaneCount]=useState(2);
  const [memberChoices,setMemberChoices]=useState([]);
  // LOC is a set. ONE request returns every Scope's exact daily totals together with
  // the set's earliest date and Scope list; detail comparisons load only when opened.
  const endDate=DEFAULT_YEAR_WINDOW.endDate;
  const [knownEarliest,setKnownEarliest]=useState('');
  const zoomRange=useMemo(()=>{
    const base=statisticsZoomWindow(zoomLevel,endDate,knownEarliest);
    return zoomLevel===0?{...base,startDate:DEFAULT_YEAR_WINDOW.startDate,
      endDate:DEFAULT_YEAR_WINDOW.endDate,bucket:'month',
      fullHistory:false,canZoomOut:false,canZoomIn:true}:base;
  },[zoomLevel,endDate,knownEarliest]);
  const {startDate,endDate:rangeEndDate,bucket}=zoomRange;
  useEffect(()=>{setSelectedPeriodKey('');setChartIntent('trend');},[startDate,rangeEndDate]);
  const observedEnd=rangeEndDate<taipeiDateKey()?rangeEndDate:taipeiDateKey();
  const initialMatches=initialData?.scopeId==='loc'&&
    initialData.startDate===startDate&&initialData.endDate===observedEnd&&
    Array.isArray(initialData.data?.rows)&&Array.isArray(initialData.data?.scopes);
  const locQuery=useAsyncResource({
    queryKey:startDate&&observedEnd&&startDate<=observedEnd
      ?['loc-statistics',startDate,observedEnd]:null,
    enabled:Boolean(startDate&&observedEnd&&startDate<=observedEnd)&&!initialMatches,
    fallbackData:initialMatches?initialData.data:undefined,
    queryFn:async()=>{
      const {selectLocStatistics}=await loadGalaxyStatistics();
      return selectLocStatistics({startDate,endDate:observedEnd});
    }
  });
  useEffect(()=>{
    const found=locQuery.data?.earliest||'';
    if(found&&found!==knownEarliest)setKnownEarliest(found);
  },[locQuery.data,knownEarliest]);
  const scopes=useMemo(()=>(locQuery.data?.scopes||[]).map(row=>({
    ...defaultScopeData(row.scope_id),label:row.display_name||row.scope_id
  })).filter(row=>row.id&&row.galaxy),[locQuery.data]);
  const scopeIds=useMemo(()=>scopes.map(scope=>String(scope.id||'').trim()).filter(Boolean),[scopes]);
  const densityQuery=locQuery;
  const densityRows=useMemo(()=>locQuery.data?.rows||[],[locQuery.data]);
  const overallTotal=useMemo(
    ()=>densityRows.reduce((sum,row)=>sum+(Number(row.item_count)||0),0),
    [densityRows]
  );
  const totals=useMemo(()=>{
    const map=new Map(scopeIds.map(id=>[id,0]));
    for(const row of densityRows){
      const id=String(row.scope_id||'').trim();
      if(!map.has(id))continue;
      map.set(id,(map.get(id)||0)+(Number(row.item_count)||0));
    }
    return scopeIds.map(id=>{
      const total=map.get(id)||0;
      return {scope_id:id,total,ratio:overallTotal>0?(total/overallTotal)*100:0};
    });
  },[densityRows,scopeIds,overallTotal]);
  const trendData=useMemo(()=>{
    if(!startDate||!rangeEndDate)return [];
    const bucketUnit=bucket;
    const buckets=new Map();
    // Do not treat future dates in the current calendar year as observed zeroes.
    for(let cursor=new Date(startDate+'T00:00:00Z'),end=new Date(observedEnd+'T00:00:00Z');cursor<=end;cursor.setUTCDate(cursor.getUTCDate()+1)){
      const day=cursor.toISOString().slice(0,10);
      const bucket=trendBucket(day,bucketUnit);
      if(!bucket||buckets.has(bucket.key))continue;
      const row={period:bucket.label,_sort:bucket.key,start_date:bucket.start,end_date:bucket.end,total:0,
        partial:bucket.start<startDate||bucket.end>observedEnd||
          bucket.end>=taipeiDateKey()};
      for(const id of scopeIds)row[id]=0;
      buckets.set(bucket.key,row);
    }
    for(const sourceRow of densityRows){
      const bucket=trendBucket(sourceRow.day,bucketUnit);
      if(!bucket)continue;
      const row=buckets.get(bucket.key)||{period:bucket.label,_sort:bucket.key,total:0};
      for(const id of scopeIds)if(row[id]===undefined)row[id]=0;
      const id=String(sourceRow.scope_id||'').trim();
      const count=Number(sourceRow.item_count)||0;
      if(scopeIds.includes(id))row[id]=(Number(row[id])||0)+count;
      row.total=(Number(row.total)||0)+count;
      buckets.set(bucket.key,row);
    }
    return [...buckets.values()].sort((a,b)=>a._sort.localeCompare(b._sort));
  },[densityRows,startDate,observedEnd,scopeIds,bucket,taipeiDateKey]);
  const insightRows=useMemo(()=>trendData.map(row=>({
    period:row.period,total:row.total,partial:row.partial,
    start_date:row.start_date,end_date:row.end_date
  })),[trendData]);
  const chartIntentOptions=useMemo(()=>availableStatisticIntents({
    rows:insightRows,totalKey:'total'
  }),[insightRows]);
  const effectiveChartIntent=chartIntentOptions.includes(chartIntent)?chartIntent:'trend';
  const selectedBucket=trendData.find(row=>row.period===selectedPeriodKey)||null;
  const selectedScopeTotals=useMemo(()=>{
    if(!selectedBucket)return [];
    const totals=new Map(scopeIds.map(id=>[id,0]));
    for(const row of densityRows){
      const day=String(row.day||'').slice(0,10),id=String(row.scope_id||'');
      if(day>=selectedBucket.start_date&&day<=selectedBucket.end_date&&totals.has(id))
        totals.set(id,(totals.get(id)||0)+(Number(row.item_count)||0));
    }
    return scopes.map(scope=>({
      key:scope.id,name:scope.label||scope.id,value:totals.get(scope.id)||0
    })).filter(row=>row.value>0).sort((a,b)=>b.value-a.value||a.name.localeCompare(b.name));
  },[selectedBucket,densityRows,scopeIds,scopes]);
  return <section className="scope-stat-section statistics-dashboard">
    <header className="scope-stat-domain-heading statistics-dashboard__heading">
      <div>
        <span className="statistics-dashboard__eyebrow">LOC / ANALYTICS</span>
        <h2>{t('uiExtra.statisticsView.dashboardTitle')}</h2>
        <p>以同一個 Dashboard 檢視作品總量、時間趨勢與各 Scope 分布。</p>
      </div>
    </header>
    {densityQuery.error?<p className="scope-status scope-error" role="alert">
      {featureDataErrorMessage(densityQuery.error,UI_COPY)}
    </p>:null}
    {densityQuery.isPending?<div className="loc-progressive-chart-frame" role="status" aria-busy="true">
      <span>正在統計 LOC 各 Scope 作品總數…</span>
      <div className="loc-progressive-chart-axis" aria-hidden="true"/>
      <small>{startDate} ～ {observedEnd}</small>
    </div>:null}
    {!densityQuery.isPending&&!densityQuery.error?<>
      <StatisticsDashboardKpis
        label={t('uiExtra.statisticsView.dashboardTitle')} items={[
          {key:'records',label:'作品總數',value:overallTotal.toLocaleString()},
          {key:'scopes',label:'所屬 Scope 數',value:scopeIds.length.toLocaleString()},
          {key:'active',label:'活躍時段',value:trendData.filter(row=>Number(row.total)>0).length.toLocaleString()}
        ]}/>
      {chartIntentOptions.length>1?<div className="scope-stat-controls">
        <label><span>分析意圖</span>
          <select className="scope-select" value={effectiveChartIntent} onChange={event=>{
            setChartIntent(event.target.value);setSelectedPeriodKey('');
          }}>
            {chartIntentOptions.map(value=><option key={value} value={value}>
              {STATISTIC_INTENTS.find(([id])=>id===value)?.[1]||value}
            </option>)}
          </select>
        </label>
      </div>:null}
      <StatisticsInsightsPanel rows={insightRows} range={zoomRange} intent={effectiveChartIntent}
        zoomLevel={zoomLevel} onZoomLevelChange={setZoomLevel}
        idPrefix="loc-stat" selectedPeriodKey={selectedPeriodKey}
        onPeriodClick={row=>setSelectedPeriodKey(String(row?.period||''))}/>
      {selectedBucket?<StatisticsDetails summary={selectedBucket.period+' · 各 Scope 分布'}>
        {()=> <div>
          <div className="scope-stat-controls">
            <span className="scope-status">點選 Scope 可進入該 Scope 的統計頁。</span>
            <button type="button" className="loc-button loc-button--small"
              onClick={()=>setSelectedPeriodKey('')}>清除選取</button>
          </div>
          {selectedScopeTotals.length?<StatisticsMultiChart intent="compare"
            distribution={selectedScopeTotals} height={Math.max(280,Math.min(10,selectedScopeTotals.length)*36+80)}
            onCategoryClick={id=>router.push(featureNavigationHref(String(id||''),'statics'))}/>
            :<p className="scope-status">這段時間沒有可比較的 Scope 紀錄。</p>}
        </div>}
      </StatisticsDetails>:null}
      <StatisticsDetails summary="各 Scope 數量分布">
        {()=> <div className="statistics-dashboard__breakdown">
          <StatisticsMultiChart intent="compare"
            distribution={totals.map(row=>({
              key:row.scope_id,
              name:scopes.find(scope=>scope.id===row.scope_id)?.label||row.scope_id,
              value:row.total
            })).filter(row=>row.value>0)}
            height={Math.max(280,Math.min(10,scopeIds.length)*36+80)}
            onCategoryClick={id=>router.push(featureNavigationHref(String(id||''),'statics'))}/>
        </div>}
      </StatisticsDetails>
      <StatisticsDetails className="scope-stat-details" summary={
        <UiText id="uiExtra.statisticsView.memberCrossTitle"/>}>
        {()=> <LocMemberIntersection key={startDate+'|'+rangeEndDate}
          scopes={scopes} startDate={startDate} endDate={rangeEndDate}
          unit={bucket} loadGalaxyStatistics={loadGalaxyStatistics}
          laneCount={memberLaneCount} onLaneCountChange={setMemberLaneCount}
          choices={memberChoices} onChoicesChange={setMemberChoices}
          zoomLevel={zoomLevel} onZoomLevelChange={setZoomLevel}
          zoomRange={zoomRange}/>}
      </StatisticsDetails>
    </>:null}
  </section>;
}

