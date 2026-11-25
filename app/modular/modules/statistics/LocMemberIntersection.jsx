'use client';
import UiText,{useUiText} from '../../../i18n/UiText';
import {useUiSection} from '../../../i18n/ui-locale';

import {useMemo} from 'react';
import {useAsyncResource,useResourceCache} from '../../../../packages/zenstack/client-queries';
import {mapBounded} from '../../../loc/query/bounded-parallel.mjs';
import {availableMemberMeasures,calculateMemberCross} from '../../../loc/statistics/member-intersection-model.mjs';
import {semanticStatisticChartTypes} from './statistics-time-zoom.mjs';
import StatisticsMultiChart from './StatisticsMultiChart';
import StatisticsChartFrame from './StatisticsChartFrame';
import StatisticsDetails from './StatisticsDetails';

const DEFAULT_LANE_COUNT=2;
export default function LocMemberIntersection({
  scopes=[],startDate='',endDate='',unit='month',
  laneCount=DEFAULT_LANE_COUNT,choices=[],graph='line',
  onLaneCountChange,onChoicesChange,onGraphChange,
  zoomLevel=0,onZoomLevelChange,zoomRange={},loadGalaxyStatistics=null
}){
  useUiSection('uiExtra.statisticsView');
  const t=useUiText();
  const resourceCache=useResourceCache();
  // The time range identifies the returned dataset. Choices live in the LOC
  // parent, so remounting one range cannot silently reset selected comparisons.
  const rangeKey=startDate+'|'+endDate;
  // The caller supplies Scope IDs and display names from the existing registry result.
  const names=useMemo(()=>new Map(scopes.map(row=>[row.id,row.label||row.id])),[scopes]);
  const available=scopes.map(scope=>({id:scope.id,label:names.get(scope.id)||scope.id,scope}));
  // Each Scope is compared through its own article totals and Galaxy.site sources.
  const allows=(person,metric)=>!metric.startsWith('source:');
  const lanes=Array.from({length:laneCount},(_,index)=>{
    const candidate=choices[index]||{};
    const fallback=available[index%Math.max(available.length,1)]?.id||'';
    const person=available.some(p=>p.id===candidate.person)?candidate.person:fallback;
    return {person,metric:candidate.metric||'total'};
  });
  const chosenIds=[...new Set(lanes.map(lane=>lane.person).filter(Boolean))];
  const fetched=useAsyncResource({
    queryKey:['loc-member-cross',startDate,endDate,chosenIds.join('|')],
    enabled:Boolean(loadGalaxyStatistics&&startDate&&endDate&&chosenIds.length),
    queryFn:async()=>{
      const pairs=await mapBounded(chosenIds,async id=>{
        // Only the Scopes chosen in the lanes are read, and only now that the panel is open.
        const scope=scopes.find(item=>item.id===id);
        const rows=scope
          ?await resourceCache.getOrLoad({
            queryKey:['own-scope-source-intersection',id,startDate,endDate],
            queryFn:async()=>(await loadGalaxyStatistics()).selectScopeSourceBreakdownRows(scope,{startDate,endDate}),
          })
          :[];
        return [id,{rows}];
      });
      return {rangeKey,datasets:new Map(pairs)};
    },
  });
  const hasCurrentData=fetched.data?.rangeKey===rangeKey;
  const datasets=hasCurrentData?fetched.data.datasets:new Map();
  const measures=availableMemberMeasures([...datasets.values()].map(item=>item.rows));
  const adjusted=lanes.map((lane,index)=>({
    ...lane,
    metric:measures.some(item=>item.id===lane.metric)&&allows(lane.person,lane.metric)
      ?lane.metric:'total',
    label:(names.get(lane.person)||lane.person)+' · '+(measures.find(item=>item.id===lane.metric)?.name||t('uiExtra.statisticsView.memberCrossAllWorks'))
  }));
  const calculated=useMemo(()=>calculateMemberCross(adjusted,datasets,{
    from:startDate,to:endDate,unit
  }),[JSON.stringify(adjusted),datasets,startDate,endDate,unit]);
  const distribution=calculated.totals.map(item=>({name:item.name,value:item.value}));
  const charts=semanticStatisticChartTypes({purpose:'comparison',rows:calculated.rows,series:calculated.series,distribution});
  const chosenChart=charts.some(([kind])=>kind===graph)?graph:(charts[0]?.[0]||'line');
  const update=(i,part)=>onChoicesChange?.(old=>{
    const next=Array.from({length:laneCount},(_,index)=>({...lanes[index]}));
    next[i]={...next[i],...part};
    return next;
  });
  if(!available.length)return null;
  return <section className="scope-stat-section"
    data-stat-cross-range={rangeKey}
    data-stat-cross-resolved-range={hasCurrentData?fetched.data.rangeKey:''}
    aria-busy={fetched.isPending||fetched.isFetching||!hasCurrentData}>
    <h2><UiText id="uiExtra.statisticsView.memberCrossTitle"/></h2>
    <div className="scope-stat-controls">
      <label><span><UiText id="uiExtra.statisticsView.memberCrossLanes"/></span>
        <select className="scope-select" value={laneCount} onChange={e=>{onLaneCountChange?.(Number(e.target.value));onChoicesChange?.([]);}}>
          {[2,3,4].map(n=><option key={n} value={n}>{n}<UiText id="uiExtra.statisticsView.memberCrossGroupUnit"/></option>)}
        </select>
      </label>
      <label><span><UiText id="uiExtra.statisticsView.memberCrossChart"/></span>
        <select className="scope-select" value={chosenChart} onChange={e=>onGraphChange?.(e.target.value)}>
          {charts.map(([value,label])=><option value={value} key={value}>{t(label)}</option>)}
        </select>
      </label>
    </div>
    <div className="scope-stat-controls">
      {lanes.map((lane,index)=><div className="scope-inline-card" key={index}>
        <label><UiText id="uiExtra.statisticsView.memberCrossPerson"/> {index+1}
          <select className="scope-select" value={lane.person} onChange={e=>update(index,{person:e.target.value,metric:'total'})}>
            {available.map(member=><option key={member.id} value={member.id}>{member.label}</option>)}
          </select>
        </label>
        <label><UiText id="uiExtra.statisticsView.memberCrossMetric"/>
          <select className="scope-select" value={adjusted[index].metric} onChange={e=>update(index,{metric:e.target.value})}>
            {measures.filter(item=>allows(lane.person,item.id)).map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
      </div>)}
    </div>
    {fetched.error?<p className="scope-status scope-error">{String(fetched.error?.message||t('uiExtra.statisticsView.memberCrossLoadError'))}</p>:null}
    {fetched.isPending||fetched.isFetching?<p className="scope-status" role="status"><UiText id="uiExtra.statisticsView.memberCrossUpdate"/></p>:null}
    {!fetched.isPending&&!fetched.isFetching&&hasCurrentData?<>
      <StatisticsChartFrame level={zoomLevel} onChange={onZoomLevelChange} range={zoomRange} idPrefix="loc-member-stat">
        <StatisticsMultiChart type={chosenChart} rows={calculated.rows} series={calculated.series}
          distribution={distribution} height={420} foldBlank/>
      </StatisticsChartFrame>
      <StatisticsDetails>{()=><>
      <div className="scope-ranking">
        <div><strong><UiText id="uiExtra.statisticsView.memberCrossCommonDays"/></strong><span>{calculated.commonDays.toLocaleString()}<UiText id="uiExtra.statisticsView.memberCrossDayUnit"/></span></div>
        <div><strong><UiText id="uiExtra.statisticsView.memberCrossUnionDays"/></strong><span>{calculated.unionDays.toLocaleString()}<UiText id="uiExtra.statisticsView.memberCrossDayUnit"/></span></div>
        <div><strong><UiText id="uiExtra.statisticsView.memberCrossRatio"/></strong><span>{calculated.unionDays?(calculated.commonDays/calculated.unionDays*100).toFixed(1):'0'}%</span></div>
        {calculated.totals.map((row,index)=><div key={index}>
          <strong>{row.name}</strong><span>{t('uiExtra.statisticsView.memberCrossRecordDays',{count:row.value.toLocaleString(),days:row.activeDays})}</span>
        </div>)}
      </div>
      </>}</StatisticsDetails>
    </>:null}
  </section>;
}
