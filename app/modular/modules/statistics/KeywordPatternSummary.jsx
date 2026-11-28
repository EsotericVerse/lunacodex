'use client';
import {useState} from 'react';
import {useAsyncResource} from '../../../../packages/zenstack/client-queries';
import StatisticsMultiChart from './StatisticsMultiChart';

// All Item/word ratios are composed from existing loc_search_pattern rows.
// No article rescan and no Lucus count is involved in this view.
export default function KeywordPatternSummary({scopeId='',classUid='',range={}}) {
  const [level,setLevel]=useState('item');
  const [selectedKey,setSelectedKey]=useState('');
  const [intent,setIntent]=useState('ranking');
  const summary=useAsyncResource({
    queryKey:['statistics-keyword-pattern-ratios',scopeId,classUid,range.startDate,range.endDate],
    enabled:Boolean(scopeId&&classUid),
    queryFn:async()=>{
      const {keywordService}=await import('../../../loc/keywords/service-client.mjs');
      return await keywordService('stats',{scopeId,classUid,
        startDate:String(range.startDate||''),endDate:String(range.endDate||'')});
    }
  });
  if(!scopeId||!classUid)return null;
  if(summary.isPending)return <p className="scope-status">正在讀取詞級統計…</p>;
  if(summary.error)return <p className="scope-status scope-error" role="alert">
    詞級統計讀取失敗：{String(summary.error.message||summary.error)}
  </p>;
  const data=summary.data||{};
  if(data.indexPending)return <p className="scope-status" role="status">
    詞級索引尚待重新分析；目前 Pattern.num=0 不代表零命中。
  </p>;
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
  const metricValues=ranked.filter(row=>Number(row.count)>0).map(row=>({
    uid:row.key,label:row.label,value:Number(row.count)||0,
    ratio:Number(row.ratio)||0,level
  }));
  const selectedRow=ranked.find(row=>String(row.key)===selectedKey)||null;
  const missing=Array.isArray(data.missing_patterns)?data.missing_patterns:[];
  return <section className="scope-card scope-stat-section">
    <h3>詞級命中與比率</h3>
    <p className="scope-status">從既有詞級 UID 紀錄計算；Item 命中數為所屬詞命中數加總，文章篇數則去重。Group／Item 比率以本 Class 的 Item 命中總數為分母；單詞比率以其所屬 Item 命中數為分母。</p>
    <label>
      <span>統計層級</span>
      <select className="scope-select" value={level}
        onChange={event=>{setLevel(event.target.value);setSelectedKey('');setIntent('ranking');}}>
        <option value="group">Group</option>
        <option value="item">Item</option>
        <option value="word">單詞</option>
      </select>
    </label>
    <div className="scope-stat-controls">
      <label><span>分析意圖</span>
        <select className="scope-select" value={intent} onChange={event=>{
          setIntent(event.target.value);setSelectedKey('');
        }}>
          <option value="ranking">看排名</option>
          {metricValues.length>1?<option value="distribution">看分布</option>:null}
        </select>
      </label>
    </div>
    {intent==='ranking'&&distribution.length?<StatisticsMultiChart intent="ranking" distribution={distribution}
      activeCategoryKey={selectedKey}
      onCategoryClick={key=>setSelectedKey(current=>current===String(key||'')?'':String(key||''))}
      height={Math.max(300,Math.min(800,distribution.length*34+90)}/>:
      intent==='distribution'&&metricValues.length>1?<StatisticsMultiChart intent="distribution"
        values={metricValues} height={380}/>:
      <p className="scope-status">尚無足夠的詞級命中紀錄。</p>}
    {selectedRow?<section className="scope-self-intersection-selected" aria-live="polite">
      <header className="statistics-dashboard__panel-heading">
        <h4>{selectedRow.label}</h4>
        <button type="button" className="loc-button loc-button--small"
          onClick={()=>setSelectedKey('')}>清除選取</button>
      </header>
      <div className="scope-ranking">
        <div><strong>命中數</strong><span>{Number(selectedRow.count||0).toLocaleString()}</span></div>
        <div><strong>比率</strong><span>{Number(selectedRow.ratio||0).toFixed(1)}%</span></div>
        <div><strong>統計層級</strong><span>{level}</span></div>
      </div>
    </section>:null}
    <div className="scope-ranking">
      {shown.map(row=><div key={row.key}
        role="button" tabIndex={0}
        aria-pressed={selectedKey===String(row.key)}
        data-selected={selectedKey===String(row.key)?'true':undefined}
        onClick={()=>setSelectedKey(current=>current===String(row.key)?'':String(row.key))}
        onKeyDown={event=>{
          if(event.key==='Enter'||event.key===' '){
            event.preventDefault();
            setSelectedKey(current=>current===String(row.key)?'':String(row.key));
          }
        }}>
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
