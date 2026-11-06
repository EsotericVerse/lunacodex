'use client';

import {useMemo,useState} from 'react';
import dynamic from 'next/dynamic';
import {useAsyncResource} from '../../../loc/use-async-resource';
import {readPlaceSummary} from '../../../loc/place-summary-client';
import {summarizePlaceStatistics} from '../../../loc/place-statistics.mjs';
import useDefaultTimeUnit from '../../../loc/use-default-time-unit';
import {useUiText} from '../../../i18n/UiText';
import {semanticStatisticChartTypes} from '../../modules/statistics/statistics-time-zoom.mjs';

const StatisticsMultiChart=dynamic(()=>import('../../modules/statistics/StatisticsMultiChart'),{loading:()=>null});
export default function PlaceStatisticsPanel({scopeId,range={}}){
  const [chartType,setChartType]=useState('bar');
  const defaultTimeUnit=useDefaultTimeUnit();
  const t=useUiText();
  const startDate=String(range.startDate||''),endDate=String(range.endDate||'');
  const query=useAsyncResource({
    queryKey:['loc-place-summary',scopeId,startDate,endDate],
    queryFn:()=>readPlaceSummary(scopeId,{startDate,endDate}),
    enabled:Boolean(scopeId&&/^\d{4}-\d{2}-\d{2}$/.test(startDate)
      &&/^\d{4}-\d{2}-\d{2}$/.test(endDate)&&startDate<=endDate),
    revalidateOnFocus:false,revalidateOnReconnect:false
  });
  const model=useMemo(()=>summarizePlaceStatistics(query.data||{},{
    bucket:defaultTimeUnit==='auto'?(['day','week','month','year'].includes(range.bucket)?range.bucket:'month'):defaultTimeUnit,limit:10
  }),[query.data,range.bucket,defaultTimeUnit]);
  // The same bounded category dataset powers both the ranking and its time trend.
  const chartChoices=semanticStatisticChartTypes({purpose:'place',
    rows:model.trend,series:model.series,distribution:model.distribution});
  const activeChart=chartChoices.some(([kind])=>kind===chartType)
    ?chartType:(chartChoices[0]?.[0]||'bar');
  return <section aria-label="地點統計" className="scope-stat-place">
    {query.isPending?<p className="scope-status" role="status">正在取得 ISR 地點統計…</p>:null}
    {query.error?<p className="scope-status scope-error" role="alert">
      地點統計讀取失敗：{String(query.error.message||query.error)}</p>:null}
    {!query.isPending&&!query.error&&!model.places.length
      ?<p className="scope-status">所選時期沒有附帶地點的公開文章。沒有建立空間定錨點也是正常狀態。</p>:null}
    {!query.error&&model.places.length>0?<div>
      <p className="scope-status">共 {model.total.toLocaleString('zh-TW')} 篇有地點作品、
        {model.places.length} 個地點、{model.anchorsCount} 個已儲存空間定錨點。</p>
      <label>統計圖型
        <select className="scope-select" value={activeChart}
          onChange={event=>setChartType(event.target.value)}>
          {chartChoices.map(([kind,label])=><option value={kind} key={kind}>{t(label)}</option>)}
        </select>
      </label>
      <StatisticsMultiChart type={activeChart} rows={model.trend}
        series={model.series} distribution={model.distribution}
        barLayout={activeChart==='bar'?'vertical':'horizontal'} height={420}/>
      <details><summary>地點排行（{model.places.length}）</summary>
        <ol className="scope-ranking">{model.places.map(place=><li key={place.name}>
          {place.name}：{place.count.toLocaleString('zh-TW')} 篇
          {place.anchored?' · 已定錨':''}
        </li>)}</ol>
      </details>
    </div>:null}
  </section>;
}
