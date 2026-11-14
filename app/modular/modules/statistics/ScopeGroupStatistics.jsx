'use client';
import {useEffect,useMemo,useState} from 'react';
import dynamic from 'next/dynamic';
import {useAsyncResource} from '../../../../zenstack/client-queries';
import {UI_COPY,registerDefaultSection} from '../../../i18n/ui-copy';
import {useUiCopy,useUiSection} from '../../../i18n/ui-locale';
import UiText,{useUiText} from '../../../i18n/UiText';
import statisticsZh from '../../../i18n/sections/statistics.zh_tw.js';
import statisticsUIZh from '../../../i18n/sections/uiExtra.statisticsUI.zh_tw.js';
import statisticsViewZh from '../../../i18n/sections/uiExtra.statisticsView.zh_tw.js';
registerDefaultSection('statistics',statisticsZh);
registerDefaultSection('uiExtra.statisticsUI',statisticsUIZh);
registerDefaultSection('uiExtra.statisticsView',statisticsViewZh);
import {defaultScopeData} from '../../../loc/scope-data';
import {featureNavigationHref} from '../../feature-navigation';
import ScopeLink from '../../ScopeLink';
import {featureDataErrorMessage} from '../../feature-data-state';
import {semanticStatisticChartTypes,chartTypeGroups,preferredStatisticChartType,statisticsZoomWindow} from './statistics-time-zoom.mjs';
import {DEFAULT_YEAR_WINDOW} from '../../../loc/default-year-window.mjs';
import StatisticsChartFrame from './StatisticsChartFrame';
import StatisticsDetails from './StatisticsDetails';
import StatisticsDashboardKpis from './StatisticsDashboardKpis';

const StatisticsMultiChart=dynamic(()=>import('./StatisticsMultiChart'),{loading:()=>null});
const StatisticsInsightsPanel=dynamic(()=>import('./StatisticsInsightsPanel'),{loading:()=>null});
const LocMemberIntersection=dynamic(()=>import('./LocMemberIntersection'),{loading:()=>null});

export default function ScopeGroupStatistics({taipeiDateKey,trendBucket,loadGalaxyStatistics}){
  useUiSection('statistics');
  useUiSection('uiExtra.statisticsUI');
  useUiSection('uiExtra.statisticsView');
  const UI_COPY=useUiCopy();
  const t=useUiText();
  const [aggregateType,setAggregateType]=useState('total');
  const [chartType,setChartType]=useState('auto');
  const [zoomLevel,setZoomLevel]=useState(0);
  // Persist intersection selections while the range-specific query remounts.
  const [memberLaneCount,setMemberLaneCount]=useState(2);
  const [memberChoices,setMemberChoices]=useState([]);
  const [memberGraph,setMemberGraph]=useState('line');
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
  const observedEnd=rangeEndDate<taipeiDateKey()?rangeEndDate:taipeiDateKey();
  const locQuery=useAsyncResource(startDate&&observedEnd&&startDate<=observedEnd
    ?['loc-statistics',startDate,observedEnd]:null,async()=>{
      const {selectLocStatistics}=await loadGalaxyStatistics();
      return selectLocStatistics({startDate,endDate:observedEnd});
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
      const row={period:bucket.label,_sort:bucket.key,total:0,
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
  const distributionData=totals.map(row=>({term:row.scope_id,value:row.total}));
  // Even when displaying a combined total, its composition is the real
  // set of child Scopes. A single 100% "LOC total" pie is not analytics.
  const locSeries=scopeIds.map(id=>({key:id,label:id}));
  const locDistribution=distributionData.map(row=>({name:row.term,value:row.value}));
  const locAllowed=semanticStatisticChartTypes({
    purpose:aggregateType==='total'?'total':'source',
    rows:trendData,series:locSeries,distribution:locDistribution,totalKey:aggregateType==='total'?'total':''
  });
  const locChartType=preferredStatisticChartType({purpose:aggregateType==='total'?'total':'source',available:locAllowed,requested:chartType});
  const chartGroups=chartTypeGroups(locAllowed,aggregateType==='total'
    ?['line','composed','bar']:['line','stacked','pie']);

  const insightRows=useMemo(()=>trendData.map(row=>({
    period:row.period,total:row.total,partial:row.partial
  })),[trendData]);
  return <section className="scope-stat-section statistics-dashboard">
    <header className="scope-stat-domain-heading statistics-dashboard__heading">
      <div>
        <span className="statistics-dashboard__eyebrow">LOC / ANALYTICS</span>
        <h2>{t('uiExtra.statisticsView.dashboardTitle')}</h2>
        <p>先看總量的高低、平均、中位數與 PELT 趨勢；傳統統計圖保留在進階檢視。</p>
      </div>
    </header>
    {densityQuery.error?<p className="scope-status scope-error" role="alert">
      {featureDataErrorMessage(densityQuery.error,UI_COPY)}
    </p>:null}
    {densityQuery.isPending?<p className="scope-status" role="status">
      正在統計 LOC 各 Scope 作品總數…
    </p>:null}
    {!densityQuery.isPending&&!densityQuery.error?<>
      <StatisticsDashboardKpis
        label={t('uiExtra.statisticsView.dashboardTitle')} items={[
          {key:'records',label:'作品總數',value:overallTotal.toLocaleString()},
          {key:'scopes',label:'所屬 Scope 數',value:scopeIds.length.toLocaleString()},
          {key:'active',label:'活躍時段',value:trendData.filter(row=>Number(row.total)>0).length.toLocaleString()}
        ]}/>
      <StatisticsChartFrame level={zoomLevel} onChange={setZoomLevel}
        range={zoomRange} idPrefix="loc-stat">
        <StatisticsInsightsPanel rows={insightRows} range={zoomRange}/>
      </StatisticsChartFrame>
      <StatisticsDetails summary="標準統計圖（折線、長條、面積與來源比較）">
        {()=> <div className="statistics-dashboard__panel" style={{display:'grid',gap:12}}>
          <div className="scope-stat-controls statistics-dashboard__filters">
            <label><span>{UI_COPY.statistics.item}</span>
              <select className="scope-select" value={aggregateType}
                onChange={event=>setAggregateType(event.target.value)}>
                <option value="total"><UiText id="uiExtra.statisticsView.memberCount"/></option>
                <option value="scope"><UiText id="uiExtra.statisticsView.memberDistribution"/></option>
              </select>
            </label>
            <label><span>{UI_COPY.statistics.chart}</span>
              <select className="scope-select" value={locChartType}
                onChange={event=>setChartType(event.target.value)}>
                {chartGroups.primary.map(([value,label])=>
                  <option key={value} value={value}>{t(label)}</option>)}
                {chartGroups.advanced.map(([value,label])=>
                  <option key={value} value={value}>{t(label)}</option>)}
              </select>
            </label>
          </div>
          <StatisticsMultiChart type={locChartType} rows={trendData}
            series={locSeries} distribution={locDistribution}
            totalKey={aggregateType==='total'?'total':''} height={420}/>
        </div>}
      </StatisticsDetails>
      <StatisticsDetails summary="各 Scope 數量分布">
        {()=> <div className="statistics-dashboard__breakdown">
          {[...totals].sort((a,b)=>b.total-a.total).map(row=>
            <div className="statistics-dashboard__breakdown-item" key={row.scope_id}>
              <div className="statistics-dashboard__breakdown-label">
                <ScopeLink href={featureNavigationHref(row.scope_id,'statics')}>
                  {scopes.find(scope=>scope.id===row.scope_id)?.label||row.scope_id}
                </ScopeLink>
                <strong>{row.total.toLocaleString()}</strong>
              </div>
              <div className="statistics-dashboard__bar" aria-hidden="true">
                <span style={{width:row.ratio+'%'}}/>
              </div>
            </div>)}
        </div>}
      </StatisticsDetails>
      <StatisticsDetails className="scope-stat-details" summary={
        <UiText id="uiExtra.statisticsView.memberCrossTitle"/>}>
        {()=> <LocMemberIntersection key={startDate+'|'+rangeEndDate}
          scopes={scopes} startDate={startDate} endDate={rangeEndDate}
          unit={bucket} loadGalaxyStatistics={loadGalaxyStatistics}
          laneCount={memberLaneCount} onLaneCountChange={setMemberLaneCount}
          choices={memberChoices} onChoicesChange={setMemberChoices}
          graph={memberGraph} onGraphChange={setMemberGraph}
          zoomLevel={zoomLevel} onZoomLevelChange={setZoomLevel}
          zoomRange={zoomRange}/>}
      </StatisticsDetails>
    </>:null}
  </section>;
}

