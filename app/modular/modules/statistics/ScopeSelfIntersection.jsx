'use client';
import FieldText from '../../../i18n/FieldText';
import {useUiLocale,useUiSection} from '../../../i18n/ui-locale';
import UiText,{useUiText} from '../../../i18n/UiText';

import {useMemo,useState} from 'react';
import {useAsyncResource} from '../../../../packages/zenstack/client-queries';
import {selectScopeSourceBreakdownRows} from '../../../loc/galaxy/galaxy-query';
import {INTERSECTION_FAMILIES,sourceIntersectionMetrics,timeIntersectionMetrics,
  spaceIntersectionMetrics,fourDimensionDailyCounts}
  from '../../../loc/statistics/four-anchor-intersection.mjs';
import {semanticStatisticChartTypes,chartTypeGroups} from './statistics-time-zoom.mjs';
import StatisticsMultiChart from './StatisticsMultiChart';
import StatisticsChartFrame from './StatisticsChartFrame';
import StatisticsDetails from './StatisticsDetails';
import {comparisonMetricGroups,selectedComparisonMetricGroup,firstAvailableGroupMetric} from './statistics-compare-options.mjs';

const DAY_MS=86400000;
// No raw From/site, Point or Date comparison metrics: select the two
// meaningful saved hierarchy levels of each of the four families.
export const DIMENSION_FILTERS=Object.freeze(
  INTERSECTION_FAMILIES.map(({value,label})=>({value,label})));
export const DIMENSIONS=Object.freeze([
  {kind:'era',label:'時代'},{kind:'period',label:'時期'},
  {kind:'trace',label:'痕跡'},{kind:'path',label:'路徑'},
  {kind:'keyword_group',label:'關鍵詞 Group'},
  {kind:'keyword_item',label:'關鍵詞 Item'},
  {kind:'source_galaxy',label:'來源 Galaxy'},
  {kind:'source_domain',label:'來源 Domain'}
]);
const dimensionForKind=kind=>
  INTERSECTION_FAMILIES.find(row=>row.types.includes(kind))?.value||'source';
const metricId=(kind,value)=>kind+String.fromCharCode(0)+value;
const dateOnly=v=>String(v||'').slice(0,10);
function canonicalBucket(day,unit){
  const date=new Date(day+'T00:00:00Z');
  if(Number.isNaN(date.getTime()))return null;
  if(unit==='year'){
    const year=date.getUTCFullYear();
    return {key:String(year),from:year+'-01-01',to:year+'-12-31'};
  }
  if(unit==='month'){
    const a=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),1));
    const b=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0));
    return {key:a.toISOString().slice(0,7),from:a.toISOString().slice(0,10),to:b.toISOString().slice(0,10)};
  }
  if(unit==='week'){
    const start=new Date(date);
    start.setUTCDate(start.getUTCDate()-((start.getUTCDay()+6)%7));
    const end=new Date(start);end.setUTCDate(end.getUTCDate()+6);
    return {key:start.toISOString().slice(0,10),from:start.toISOString().slice(0,10),to:end.toISOString().slice(0,10)};
  }
  return {key:day,from:day,to:day};
}
export default function ScopeSelfIntersection({scope,range,classUid='',zoomLevel=0,onZoomLevelChange,sharedCatalog=null}){
  useUiSection('uiExtra.selfIntersection');
  useUiSection('uiExtra.statisticsView');
  const {locale,copy}=useUiLocale();
  const t=useUiText();
  const l=copy.uiExtra.selfIntersection;
  const [numberOfLanes,setNumberOfLanes]=useState(2);
  const [selected,setSelected]=useState([]);
  const [laneKinds,setLaneKinds]=useState([]);
  const [chartType,setChartType]=useState('line');
  const [foldBlank,setFoldBlank]=useState(true);
  const start=dateOnly(range?.startDate),end=dateOnly(range?.endDate);
  const valid=Boolean(scope?.id&&scope.galaxy&&scope.anchor&&start&&end&&start<=end);
  const query=useAsyncResource(valid?['own-scope-source-intersection',scope?.id,start,end]:null,
    ()=>selectScopeSourceBreakdownRows(scope,{startDate:start,endDate:end}));
  const rows=query.data||[];
  const localCatalog=useAsyncResource(valid&&!sharedCatalog?['own-scope-source-catalog',scope?.id]:null,async()=>{
    const {readPublicSourceTaxonomy}=await import('../../../loc/source/catalog-public.mjs');
    return readPublicSourceTaxonomy();
  });
  const catalog=sharedCatalog||localCatalog;
  // Read the already-stored keyword summary only when this panel is expanded.
  const keywords=useAsyncResource({
    queryKey:['own-scope-keyword-summary',scope?.id,classUid,start,end],
    enabled:valid,
    queryFn:async()=>{
      const {selectKeywordAnalysisSummary}=await import('../../../loc/keywords/analysis');
      return selectKeywordAnalysisSummary({scopeId:scope.id,classUid,startDate:start,endDate:end});
    }
  });
  const keywordTabAvailable=Boolean(keywords.data?.statisticsEnabled&&
    (keywords.data?.runeTotals||[]).some(item=>Number(item.document_count)>0));
  // Time and Space are loaded only after a lane selects their family. Neither
  // adds a read to the main Statistics landing or unrelated comparisons.
  const availableKinds=INTERSECTION_FAMILIES.map(row=>row.value);
  const maximumLanes=8;
  const lanes=Math.max(2,Math.min(numberOfLanes,maximumLanes));
  const shownKinds=Array.from({length:lanes},(_,index)=>
    availableKinds.includes(laneKinds[index])?laneKinds[index]:
    index===0?'source':'keyword');
  const keywordModeActive=keywordTabAvailable&&shownKinds.includes('keyword');
  const timeAnchors=useAsyncResource({
    queryKey:['scope-intersection-time-anchor',scope?.id],
    enabled:valid&&shownKinds.includes('time'),
    queryFn:async({signal})=>{
      const {readAllAnchorFeature}=await import('../../../loc/model/feature-transaction-client.mjs');
      return readAllAnchorFeature({scope:scope.id,family:'time',
        types:['era','period','date'],signal});
    },
    revalidateOnFocus:false,revalidateOnReconnect:false
  });
  const spaceAnchors=useAsyncResource({
    queryKey:['scope-intersection-space-anchor',scope?.id],
    enabled:valid&&shownKinds.includes('space'),
    queryFn:async({signal})=>{
      const {readAllAnchorFeature}=await import('../../../loc/model/feature-transaction-client.mjs');
      return readAllAnchorFeature({scope:scope.id,family:'space',
        types:['trace','path','point'],signal});
    },
    revalidateOnFocus:false,revalidateOnReconnect:false
  });
  const territory=useAsyncResource({
    queryKey:['scope-intersection-territory',scope?.id,start,end],
    enabled:valid&&shownKinds.includes('space'),
    queryFn:async({signal})=>{
      const {dbPublicClient}=await import('../../../loc/db/db-client.mjs');
      const {data,error}=await dbPublicClient.schema('silver').analytics({
        p_scope_id:scope.id,p_view:'trace_territory',
        p_start:start,p_end:end,p_options:{withPoints:false},signal
      });
      if(error)throw error;
      if(!Array.isArray(data))throw Error('Invalid territory statistics');
      return data;
    },
    revalidateOnFocus:false,revalidateOnReconnect:false
  });
  // Resolve Class -> group -> item from the current Scope's *real* keyword
  // catalog. Stored aggregate metadata has item labels but no group mapping.
  const keywordCatalog=useAsyncResource({
    queryKey:['scope-advanced-keyword-catalog',scope?.id,keywords.data?.keywordMeta?.class_uid],
    enabled:valid&&keywordModeActive&&Boolean(scope?.keywords&&keywords.data?.keywordMeta?.class_uid),
    queryFn:async()=>{
      const {keywordService}=await import('../../../loc/keywords/service-client.mjs');
      const {keywordClassCatalog}=await import('../../../loc/keywords/tree.mjs');
      const result=await keywordService('catalog',{
        scopeId:scope.id,classUid:keywords.data.keywordMeta.class_uid});
      if(!result.class_uid)return [];
      const {catalog}=keywordClassCatalog(result.rows,result.class_uid);
      return catalog.map(item=>({
        uid:item.uid,group_uid:item.group_uid,class_group:item.class_group
      }));
    }
  });
  const keywordItemGroup=useMemo(()=>new Map((keywordCatalog.data||[])
    .filter(item=>item.class_enable!==false&&String(item.group_uid||''))
    .map(item=>[String(item.uid),String(item.group_uid)])),
  [keywordCatalog.data]);
  const sourceMetrics=useMemo(()=>sourceIntersectionMetrics(catalog.data||{}),
    [catalog.data]);
  const timeMetrics=useMemo(()=>timeIntersectionMetrics(timeAnchors.data||[]),
    [timeAnchors.data]);
  const spaceMetrics=useMemo(()=>spaceIntersectionMetrics(spaceAnchors.data||[]),
    [spaceAnchors.data]);
  const hierarchyMetrics=useMemo(()=>[...timeMetrics,...spaceMetrics,...sourceMetrics],
    [timeMetrics,spaceMetrics,sourceMetrics]);
  const hierarchyCounts=useMemo(()=>fourDimensionDailyCounts({
    selected:hierarchyMetrics,sourceRows:rows,
    taxonomy:catalog.data||{},placeRows:territory.data||[]
  }),[hierarchyMetrics,rows,catalog.data,territory.data]);
  const categoryList=useMemo(()=>{
    const metrics=hierarchyMetrics.map(item=>({
      ...item,total:[...(hierarchyCounts.get(item.id)?.values()||[])]
        .reduce((sum,n)=>sum+Number(n||0),0)
    }));
    const analysis=keywords.data?.statisticsEnabled?keywords.data:null;
    const groups=(analysis?.groupTotals||[]).map(row=>({
      id:metricId('keyword_group',row.group_uid),kind:'keyword_group',
      uid:String(row.group_uid),name:String(row.group||row.group_uid),
      total:Number(row.document_count)||0
    }));
    const items=(analysis?.runeTotals||[]).map(row=>({
      id:metricId('keyword_item',row.uid),kind:'keyword_item',
      group_uid:keywordItemGroup.get(String(row.uid))||'',
      name:String(row.label||row.uid),total:Number(row.document_count)||0
    }));
    return [...metrics,...groups,...items];
  },[hierarchyMetrics,hierarchyCounts,keywords.data,keywordItemGroup]);
  const candidatesForLane=index=>categoryList.filter(item=>
    dimensionForKind(item.kind)===shownKinds[index]);
  const chosen=Array.from({length:lanes},(_,index)=>{
    const candidates=candidatesForLane(index);
    const id=selected[index];
    if(id&&candidates.some(item=>item.id===id)&&!selected.slice(0,index).includes(id))return id;
    const reserved=new Set(selected.filter((_,position)=>position!==index));
    return candidates.find(item=>!reserved.has(item.id))?.id||'';
  });
  const used=new Set();
  const selection=chosen.map((id,index)=>{
    const options=candidatesForLane(index);
    const output=id&&!used.has(id)?id:options.find(item=>!used.has(item.id))?.id||'';
    if(output)used.add(output);
    return output;
  });
  const categories=selection.map(id=>categoryList.find(c=>c.id===id)).filter(Boolean);
  const selectedKeywordItems=categories.some(item=>item.kind==='keyword_item');
  // Item-by-day data are not in the summary RPC. Load saved attributes only
  // when an item is actually selected, without reading or analyzing article bodies.
  const keywordItems=useAsyncResource({
    queryKey:['own-scope-keyword-item-days',scope?.id,classUid,start,end],
    enabled:valid&&keywordModeActive&&selectedKeywordItems,
    queryFn:async()=>{
      const {keywordService}=await import('../../../loc/keywords/service-client.mjs');
      return keywordService('summary',{scopeId:scope.id,
        classUid:keywords.data?.keywordMeta?.class_uid||classUid,
        startDate:start,endDate:end});
    }
  });
  const unit=['year','month','week','day'].includes(range?.bucket)?range.bucket:(Date.parse(end)-Date.parse(start))/DAY_MS>180?'month':(Date.parse(end)-Date.parse(start))/DAY_MS>60?'week':'day';
  const calculated=useMemo(()=>{
    if(!valid||!categories.length)return {chart:[],days:[],totals:[]};
    const counts=new Map(), activeDays=new Map();
    const selectedIds=new Set(categories.map(category=>category.id));
    const add=(day,id,value)=>{
      if(!selectedIds.has(id)||!day||day<start||day>end||value<=0)return;
      const bucket=canonicalBucket(day,unit);
      if(!bucket)return;
      const item=counts.get(bucket.key)||{period:bucket.key,start_date:bucket.from,end_date:bucket.to};
      item[id]=(Number(item[id])||0)+value;
      counts.set(bucket.key,item);
      const active=activeDays.get(day)||new Set();
      active.add(id);
      activeDays.set(day,active);
    };
    // The one selected hierarchy metric owns its counts; a child never adds
    // another copy to its parent lane. Shared dates are intersections, not
    // evidence that the same article matched multiple independent metrics.
    for(const [id,byDay] of hierarchyCounts)
      for(const [day,count] of byDay)add(day,id,count);
    // One Class per article. The existing summary already aggregates by day.
    for(const row of keywords.data?.classifications||[]){
      add(dateOnly(row.date),'keyword_group'+String.fromCharCode(0)+row.group_uid,Number(row.count)||0);
    }
    if(selectedKeywordItems){
      for(const row of keywordItems.data||[]){
        if(row.kind==='item_day')
          add(dateOnly(row.day),metricId('keyword_item',String(row.item_key)),
            Number(row.document_count)||0);
      }
    }
    const chart=[];
    for(let date=new Date(start+'T00:00:00Z'),limit=new Date(end+'T00:00:00Z');date<=limit;){
      const day=date.toISOString().slice(0,10);
      const bucket=canonicalBucket(day,unit);
      const previous=chart.at(-1);
      if(previous?.period!==bucket.key)chart.push({
        period:bucket.key,start_date:bucket.from,end_date:bucket.to,
        ...Object.fromEntries(categories.map(category=>[category.id,Number(counts.get(bucket.key)?.[category.id])||0]))
      });
      date=new Date(bucket.to+'T00:00:00Z');date.setUTCDate(date.getUTCDate()+1);
    }
    return {
      chart,
      days:[...activeDays.values()].filter(day=>categories.every(category=>day.has(category.id))).length,
      totals:categories.map(category=>({
        name:category.name,
        value:chart.reduce((n,bucket)=>n+Number(bucket[category.id]||0),0)
      }))
    };
  },[hierarchyCounts,categories.map(c=>c.id).join(String.fromCharCode(0)),
    start,end,unit,valid,keywords.data,keywordItems.data,selectedKeywordItems]);
  const series=categories.map(c=>({key:c.id,label:c.name}));
  const enough=maximumLanes>=2&&categories.length===lanes;
  const availableCharts=semanticStatisticChartTypes({purpose:'comparison',rows:calculated.chart,series,distribution:calculated.totals});
  const shownChartType=availableCharts.some(([id])=>id===chartType)?chartType:(availableCharts[0]?.[0]||'line');
  const chartGroups=chartTypeGroups(availableCharts,['line','stacked','scatter']);

  return <section className="scope-stat-section scope-self-intersection" aria-label={t('uiExtra.statisticsView.selfIntersectionTitle')}>
    <h3><UiText id="uiExtra.statisticsView.selfIntersectionTitle"/></h3>
      {query.isPending||keywords.isPending?<p className="scope-status">{l.readingSources}</p>:null}
      {shownKinds.includes('time')&&timeAnchors.isPending
        ?<p className="scope-status" role="status">正在讀取時代／時期…</p>:null}
      {shownKinds.includes('space')&&(spaceAnchors.isPending||territory.isPending)
        ?<p className="scope-status" role="status">正在讀取痕跡／路徑…</p>:null}
      {query.error||catalog.error?<p className="scope-status scope-error">{String(query.error?.message||catalog.error?.message||l.readFailed)}</p>:null}
      {keywords.error?<p className="scope-status scope-error">關鍵詞分佈載入失敗：{String(keywords.error?.message||keywords.error)}</p>:null}
      {timeAnchors.error?<p className="scope-status scope-error">時代／時期讀取失敗：{String(timeAnchors.error?.message||timeAnchors.error)}</p>:null}
      {spaceAnchors.error||territory.error?<p className="scope-status scope-error">痕跡／路徑讀取失敗：{String(spaceAnchors.error?.message||territory.error?.message||'')}</p>:null}
      {!query.isPending&&!catalog.isPending&&!query.error&&!catalog.error?<div className="scope-self-intersection-content">
        <div className="scope-stat-controls">
          <label><span><FieldText text="比較組數"/></span>
            <select className="scope-select" value={lanes} onChange={e=>{setNumberOfLanes(Number(e.target.value));setSelected([])}}>
              {Array.from({length:Math.max(0,maximumLanes-1)},(_,i)=>i+2).map(n=><option key={n} value={n}>{n}{l.groupUnit}</option>)}
              {maximumLanes<2?<option value={2}>可比較項目不足</option>:null}
            </select>
          </label>
        </div>
        <div className="scope-self-intersection-comparisons">
          {Array.from({length:lanes},(_,index)=>{
            const kind=shownKinds[index];
            const chosenId=selection[index]||'';
            const selectMetric=id=>setSelected(previous=>{
              const next=[...selection];next[index]=id;return next;
            });
            const switchKind=nextKind=>{
              setLaneKinds(previous=>{
                const next=[...shownKinds];next[index]=nextKind;return next;
              });
              setSelected(previous=>{
                const next=[...selection];next[index]='';return next;
              });
            };
            const ofKind=kind=>categoryList.filter(item=>item.kind===kind);
            // Pick a higher-level ancestor first, then either that ancestor
            // or its direct child. Saved UID edges define every relationship.
            const galaxies=ofKind('source_galaxy'),domains=ofKind('source_domain');
            const sources=galaxies.map(parent=>({
              name:parent.name,item:parent,
              items:domains.filter(item=>item.path?.includes(parent.uid))
            }));
            const eras=ofKind('era'),periods=ofKind('period');
            const usedPeriods=new Set(eras.flatMap(x=>x.children||[]));
            const times=[
              ...eras.map(parent=>({name:parent.name,item:parent,
                items:periods.filter(item=>parent.children?.includes(item.uid))})),
              ...(!periods.some(x=>!usedPeriods.has(x.uid))?[]:[{
                name:'未歸屬時期',items:periods.filter(x=>!usedPeriods.has(x.uid))
              }])
            ];
            const traces=ofKind('trace'),paths=ofKind('path');
            const usedPaths=new Set(traces.flatMap(x=>x.children||[]));
            const spaces=[
              ...traces.map(parent=>({name:parent.name,item:parent,
                items:paths.filter(item=>parent.children?.includes(item.uid))})),
              ...(!paths.some(x=>!usedPaths.has(x.uid))?[]:[{
                name:'未歸屬路徑',items:paths.filter(x=>!usedPaths.has(x.uid))
              }])
            ];
            const keywordGroups=ofKind('keyword_group').map(parent=>({
              name:parent.name,item:parent,
              items:ofKind('keyword_item').filter(item=>item.group_uid===parent.uid)
            }));
            const groups=comparisonMetricGroups(kind,{
              time:times,space:spaces,keyword:keywordGroups,source:sources
            });
            const currentGroup=selectedComparisonMetricGroup(groups,chosenId);
            const selectedGroupMetrics=currentGroup?.options||[];
            const takenByOther=new Set(selection.filter((_,lane)=>lane!==index));
            return <section className="scope-self-intersection-lane" key={index}
              aria-label={l.comparisonItem+' '+(index+1)}>
              <strong>{l.comparisonItem} {index+1}</strong>
              <div className="scope-self-intersection-kind-tabs" role="group"
                aria-label={l.comparisonItem+' '+(index+1)+' 類型'}>
                {DIMENSION_FILTERS.map(tab=>
                  <button type="button" className="scope-self-stat-tab" key={tab.value}
                    aria-pressed={kind===tab.value} onClick={()=>switchKind(tab.value)}>
                    {tab.label}
                  </button>)}
              </div>
              <div className="scope-self-intersection-category-groups">
                <label className="scope-self-stat-picker"><span>類別</span>
                  <select className="scope-select" aria-label={l.comparisonItem+' '+(index+1)+' 類別'}
                    value={currentGroup?.key||''}
                    onChange={event=>{
                      const target=groups.find(group=>group.key===event.target.value);
                      const id=firstAvailableGroupMetric(target,takenByOther);
                      if(id)selectMetric(id);
                    }}>
                    {!groups.length?<option value="">無可用類別</option>:null}
                    {groups.map(group=><option key={group.key} value={group.key}
                      disabled={!firstAvailableGroupMetric(group,takenByOther)}>{group.name}</option>)}
                  </select>
                </label>
                <label className="scope-self-stat-picker"><span>項目</span>
                  <select className="scope-select" aria-label={l.comparisonItem+' '+(index+1)+' 項目'}
                    value={selectedGroupMetrics.some(item=>item.id===chosenId)?chosenId:''}
                    disabled={!selectedGroupMetrics.length}
                    onChange={event=>selectMetric(event.target.value)}>
                    {!selectedGroupMetrics.length?<option value="">無可用項目</option>:null}
                    {selectedGroupMetrics.map(item=><option key={item.id} value={item.id}
                      disabled={takenByOther.has(item.id)}>{item.name}</option>)}
                  </select>
                </label>
                {kind==='keyword'?keywordCatalog.isPending
                  ?<p className="scope-status" role="status">正在讀取組內項目…</p>:null:null}
                {kind==='keyword'&&keywordCatalog.error?<p role="alert" className="scope-status scope-error">
                  組內關鍵詞讀取失敗：{String(keywordCatalog.error?.message||keywordCatalog.error)}
                </p>:null}
                {!groups.length?<p className="scope-status">{l.noSelectableSource}</p>:null}
              </div>
            </section>;
          })}
        </div>
        <div className="scope-stat-controls">
          <label><span><FieldText text="圖表"/></span>
            <select className="scope-select" value={chartType} onChange={e=>setChartType(e.target.value)}>
              {chartGroups.primary.length?<optgroup label={t('uiExtra.statisticsView.chartPrimary')}>
  {chartGroups.primary.map(([value,label])=><option key={value} value={value}>{t(label)}</option>)}
</optgroup>:null}
{chartGroups.advanced.length?<optgroup label={t('uiExtra.statisticsView.chartAdvanced')}>
  {chartGroups.advanced.map(([value,label])=><option key={value} value={value}>{t(label)}</option>)}
</optgroup>:null}{!availableCharts.length?<option value="line"><FieldText text="尚無可用圖形"/></option>:null}
            </select>
          </label>
          <label className="scope-setting-toggle"><input type="checkbox" checked={foldBlank} onChange={e=>setFoldBlank(e.target.checked)}/> {l.foldEmptyTime}</label>
        </div>
        {selectedKeywordItems&&keywordItems.isPending?<p className="scope-status" role="status">正在讀取關鍵詞項目的每日統計…</p>:null}
        {selectedKeywordItems&&keywordItems.error?<p role="alert" className="scope-status scope-error">{String(keywordItems.error?.message||keywordItems.error)}</p>:null}
        {enough&&(!selectedKeywordItems||keywordItems.isSuccess)?<div>
          <StatisticsChartFrame level={zoomLevel} onChange={onZoomLevelChange} range={range} idPrefix="scope-self-stat">
            <StatisticsMultiChart type={shownChartType} rows={calculated.chart} series={series}
              distribution={calculated.totals} foldBlank={foldBlank} height={410}/>
          </StatisticsChartFrame>
          <p className="scope-status">交錯以「同日活躍」計算；時間取已存 Era／Period 區間，空間取已存 Trace／Path 之 Point 範圍，關鍵詞為 Group／Item，來源為 Galaxy／Domain。不同維度同日出現不代表同一篇文章同時命中。</p>
          <StatisticsDetails>{()=><>
          <div className="scope-ranking">
            <div><strong>{l.activeDays}</strong><span>{calculated.days.toLocaleString(locale)}{l.dayUnit}</span></div>
            {calculated.totals.map(item=><div key={item.name}><strong>{item.name}</strong><span>{item.value.toLocaleString(locale)}{l.recordUnit}</span></div>)}
          </div>
          </>}</StatisticsDetails>
        </div>:!enough?<p className="scope-status">{l.notEnoughSources.replace('{count}',lanes)}</p>:null}
      </div>:null}
  </section>;
}
