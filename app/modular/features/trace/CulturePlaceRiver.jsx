'use client';

import {useMemo,useState} from 'react';
import dynamic from 'next/dynamic';
import {useAsyncResource} from '../../../../zenstack/client-queries';
import {readPlaceSummary} from '../../../loc/place-summary-client';
import {placeRiverModel} from '../../../loc/place-statistics.mjs';

const CultureTimeline=dynamic(()=>import('../../modules/culture-timeline/CultureTimeline'),{loading:()=>null});
const dateOk=value=>/^\d{4}-\d{2}-\d{2}$/.test(String(value||''));

export default function CulturePlaceRiver({scopeId,startDate='',endDate=''}){
  const [selectedPlace,setSelectedPlace]=useState('');
  const ready=dateOk(startDate)&&dateOk(endDate)&&startDate<=endDate;
  const result=useAsyncResource({
    queryKey:['loc-place-summary',scopeId,startDate,endDate],
    queryFn:()=>readPlaceSummary(scopeId,{startDate,endDate}),
    enabled:Boolean(scopeId)&&ready,
    revalidateOnFocus:false,revalidateOnReconnect:false
  });
  const model=useMemo(()=>placeRiverModel(result.data||{},selectedPlace,12),[result.data,selectedPlace]);
  return <section className="scope-culture-trace-river" aria-label="痕跡：地點河道">
    <div className="scope-stat-controls">
      <label><span>地點</span><select className="scope-select" value={selectedPlace}
        onChange={event=>setSelectedPlace(event.target.value)}>
        <option value="">最常出現的 12 個地點</option>
        {model.places.map(place=><option key={place.name} value={place.name}>
          {place.name}（{place.count}）{place.anchored?'· 已定錨':''}
        </option>)}
      </select></label>
      <p className="scope-status">{model.total.toLocaleString('zh-TW')} 篇有地點的公開作品，
        {model.places.length} 個不同地點；其中已建立 {model.anchorsCount} 個空間定錨點。</p>
    </div>
    {!ready?<p className="scope-status">尚未選擇有效時間範圍。</p>:null}
    {result.isPending?<p className="scope-status" role="status">正在讀取地點快取…</p>:null}
    {result.error?<p role="alert" className="scope-status scope-error">
      地點統計讀取失敗：{String(result.error.message||result.error)}</p>:null}
    {ready&&!result.isPending&&!result.error&&!model.items.length
      ?<p className="scope-status">此時間範圍尚無有地點的文章。沒有打卡地點或空間定錨點都屬正常狀態。</p>:null}
    {ready&&!result.error&&model.items.length>0?<CultureTimeline
      key={selectedPlace||'top12'}
      items={model.items} extraGroups={model.groups}
      labelOf={()=>''} mode="source" heightVariant="double"
      windowStart={startDate} windowEnd={endDate}
    />:null}
    {!selectedPlace&&model.places.length>12?<p className="scope-status">
      為避免河道過長，先展示前 12 個地點；其他地點仍可由上方選單逐一查看。</p>:null}
  </section>;
}
