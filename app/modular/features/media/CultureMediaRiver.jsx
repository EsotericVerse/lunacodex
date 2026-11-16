'use client';

import {useMemo} from 'react';
import dynamic from 'next/dynamic';
import {useAsyncResource} from '../../../../packages/zenstack/client-queries';
import {ANCHOR_TYPE_GROUPS} from '../../../../packages/zenstack/anchor-hierarchy.mjs';
import {dbPublicClient} from '../../../loc/db-client.mjs';

const CultureTimeline=dynamic(()=>import('../../modules/culture-timeline/CultureTimeline'),{loading:()=>null});
const TYPE_LABELS=Object.freeze({image:'圖片',video:'影片',rune:'符文',suno:'音樂'});
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const mediaTypes=ANCHOR_TYPE_GROUPS.media;
const dayAfter=value=>{
  const date=new Date(value+'T00:00:00Z');
  date.setUTCDate(date.getUTCDate()+1);
  return date.toISOString().slice(0,10);
};

function mediaRiverModel(rows=[]){
  // One media-type GROUP BY from the existing ZModel MediaAnchor. Only numeric
  // daily buckets reach this client; no item list, blob or extra stored index.
  const entries=(Array.isArray(rows)?rows:[]).filter(row=>
    mediaTypes.includes(row.category)&&DATE.test(String(row.day||''))&&
    Number(row.item_count)>0);
  const totals=new Map(),maxima=new Map();
  for(const row of entries){
    const type=row.category,count=Number(row.item_count);
    totals.set(type,(totals.get(type)||0)+count);
    maxima.set(type,Math.max(maxima.get(type)||0,count));
  }
  const groups=mediaTypes.filter(type=>totals.has(type)).map(type=>({
    id:'media:'+type,label:TYPE_LABELS[type]+'（'+totals.get(type).toLocaleString('zh-TW')+'）',
    order:mediaTypes.indexOf(type)
  }));
  const items=entries.map(row=>{
    const type=row.category,count=Number(row.item_count),day=String(row.day);
    const label=TYPE_LABELS[type];
    return {
      id:'media:'+type+':'+day,
      entry_id:'media:'+type+':'+day,
      entry_type:'media_density',
      group_key:'media:'+type,
      group_label:label,
      group_order:mediaTypes.indexOf(type),
      start_date:day,
      end_date:dayAfter(day),
      item_count:count,
      density_ratio:count/Math.max(1,maxima.get(type)||1),
      display_label:'',
      title:day+' · '+label+' · '+count.toLocaleString('zh-TW')
    };
  });
  return {items,groups};
}

export default function CultureMediaRiver({scopeId,startDate='',endDate=''}) {
  const ready=DATE.test(startDate)&&DATE.test(endDate)&&startDate<=endDate;
  const query=useAsyncResource({
    queryKey:['culture-media-types',scopeId,startDate,endDate],
    enabled:Boolean(scopeId)&&ready,
    // The existing public Kysely lane_daily query groups all four canonical
    // MediaAnchor types server-side in one request, only when Media is chosen.
    queryFn:async()=>{
      const {data,error}=await dbPublicClient.schema('silver').analytics({
        p_scope_id:scopeId,p_view:'lane_daily',
        p_start:startDate,p_end:endDate,
        p_options:{media:true,mediaTypeGroups:true}
      });
      if(error)throw error;
      if(!Array.isArray(data))throw new Error('Invalid MediaAnchor daily response');
      return data;
    },
    revalidateOnFocus:false,revalidateOnReconnect:false
  });
  const model=useMemo(()=>mediaRiverModel(query.data),[query.data]);
  return <section className="scope-culture-media-river" aria-label="多媒體河道">
    {query.isPending?<p className="scope-status" role="status">載入中…</p>:null}
    {query.error?<p className="scope-status scope-error" role="alert">
      {String(query.error.message||query.error)}</p>:null}
    {ready&&!query.isPending&&!query.error&&!model.items.length
      ?<p className="scope-status">此期間無多媒體資料。</p>:null}
    {ready&&!query.error&&model.items.length>0?<CultureTimeline
      items={model.items} extraGroups={model.groups}
      labelOf={()=>''} mode="source" heightVariant="double"
      windowStart={startDate} windowEnd={endDate}/>:null}
  </section>;
}
