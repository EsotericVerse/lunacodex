'use client';
import {useState} from 'react';
import {useAsyncResource} from '../../../loc/use-async-resource';
import StatisticsMultiChart from './StatisticsMultiChart';

// All Item/word ratios are composed from existing loc_search_pattern rows.
// No article rescan and no Anchor count is involved in this view.
export default function KeywordPatternSummary({scopeId='',classUid=''}) {
  const [level,setLevel]=useState('item');
  const summary=useAsyncResource({
    queryKey:['statistics-keyword-pattern-ratios',scopeId,classUid],
    enabled:Boolean(scopeId&&classUid),
    queryFn:async()=>{
      const {dbAuthClient}=await import('../../../loc/db-client.mjs');
      const {data,error}=await dbAuthClient.schema('silver').managedAction(
        'keyword_pattern_statistics',{p_scope_id:scopeId,p_class_uid:classUid});
      if(error)throw error;
      return data||{};
    }
  });
  if(!scopeId||!classUid)return null;
  if(summary.isPending)return <p className="scope-status">正在讀取詞級統計…</p>;
  if(summary.error)return <p className="scope-status scope-error" role="alert">
    詞級統計讀取失敗：{String(summary.error.message||summary.error)}
  </p>;
  const data=summary.data||{};
  const items=Array.isArray(data.items)?data.items:[];
  const rows=level==='group'
    ?(data.groups||[]).map(group=>({key:group.uid,label:group.name,
      count:group.hit_count,ratio:group.ratio}))
    :level==='item'
      ?items.map(item=>({key:item.uid,label:item.name,count:item.hit_count,
        ratio:item.ratio}))
      :items.flatMap(item=>item.words.filter(word=>word.indexed).map(word=>({
        key:item.uid+':'+word.pattern,label:item.name+' / '+word.pattern,
        count:word.count,ratio:word.ratio
      })));
  const ranked=[...rows].sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label));
  const shown=ranked.slice(0,30);
  const distribution=shown.filter(row=>row.count>0).map(row=>({
    key:row.key,name:row.label,value:row.count
  }));
  const missing=Array.isArray(data.missing_patterns)?data.missing_patterns:[];
  return <section className="scope-card scope-stat-section">
    <h3>詞級命中與比率</h3>
    <p className="scope-status">從既有詞級 UID 紀錄計算；Item 命中數為所屬詞命中數加總，文章篇數則去重。</p>
    <label>
      <span>統計層級</span>
      <select className="scope-select" value={level}
        onChange={event=>setLevel(event.target.value)}>
        <option value="group">Group</option>
        <option value="item">Item</option>
        <option value="word">單詞</option>
      </select>
    </label>
    {distribution.length?<StatisticsMultiChart type="bar" distribution={distribution}
      barLayout="vertical" height={Math.max(300,Math.min(800,distribution.length*34+90))}/>:
      <p className="scope-status">尚無詞級命中紀錄。</p>}
    <div className="scope-ranking">
      {shown.map(row=><div key={row.key}>
        <strong>{row.label}</strong>
        <span>{Number(row.count||0).toLocaleString()} 次 · {Number(row.ratio||0).toFixed(1)}%</span>
      </div>)}
    </div>
    {ranked.length>shown.length?<p className="scope-status">
      顯示前 {shown.length} 筆，依命中數排序。
    </p>:null}
    {missing.length?<p className="scope-status" role="note">
      {missing.length} 個新詞尚未建立自己的詞級 UID 紀錄，其他已解析詞仍直接沿用。
    </p>:null}
  </section>;
}
