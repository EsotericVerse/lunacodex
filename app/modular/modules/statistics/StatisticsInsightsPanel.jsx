'use client';

import {useEffect,useMemo,useState} from 'react';
import {
  CartesianGrid,Line,LineChart,ReferenceDot,ReferenceLine,
  ResponsiveContainer,Tooltip,XAxis,YAxis
} from 'recharts';
import {explainPeltChange,totalPeriodStats} from './statistics-insights.mjs';

const amount=value=>Number(value||0).toLocaleString('zh-TW',{
  maximumFractionDigits:1
});
const insightText=insight=>{
  if(!insight.detected)return '目前沒有偵測到明確的結構性變化；短期波動不代表趨勢。';
  const change=insight.direction==='up'?'上升':insight.direction==='down'?'下降':'持平';
  const ratio=insight.changePercent===null
    ?'（前段平均為零，無法計算百分比）'
    :'（'+(insight.changePercent>0?'+':'')+insight.changePercent.toFixed(1)+'%）';
  return '從 '+insight.boundary+' 起，作品密度'+change+'。變化前每期平均 '+
    amount(insight.before)+'，變化後 '+amount(insight.after)+' '+ratio+'。';
};

export default function StatisticsInsightsPanel({rows=[],range={},title='總量趨勢洞察'}){
  const stats=useMemo(()=>totalPeriodStats(rows),[rows]);
  const [points,setPoints]=useState([]);
  const [pending,setPending]=useState(false);
  const [workerError,setWorkerError]=useState(false);
  const [topCount,setTopCount]=useState(5);
  useEffect(()=>{
    if(stats.values.length<6||stats.total===0){
      setPoints([]);setPending(false);setWorkerError(false);return;
    }
    let active=true,worker;
    setPending(true);setPoints([]);setWorkerError(false);
    try{
      worker=new Worker(new URL('./statistics-insights-worker.mjs',import.meta.url),{type:'module'});
      worker.onmessage=event=>{
        if(!active)return;
        setPoints(Array.isArray(event.data?.points)?event.data.points:[]);
        setWorkerError(Boolean(event.data?.error));
        setPending(false);worker.terminate();
      };
      worker.onerror=()=>{
        if(active){setWorkerError(true);setPending(false);}
        worker.terminate();
      };
      worker.postMessage({values:stats.values});
    }catch{
      if(active){setWorkerError(true);setPending(false);}
    }
    return ()=>{active=false;worker?.terminate();};
  },[stats.values,stats.total]);
  const insight=useMemo(()=>explainPeltChange(rows,points),[rows,points]);
  const activeCount=Math.min(10,stats.entries.length);
  const upCount=Math.min(topCount,activeCount);
  const downCount=Math.max(0,activeCount-upCount);
  const top=stats.top.slice(0,upCount);
  const topKeys=new Set(top.map(row=>row.period));
  const bottom=stats.bottom.filter(row=>!topKeys.has(row.period)).slice(0,downCount);
  const metric=[
    {key:'highest',label:'最高',value:stats.maximum?.value,period:stats.maximum?.period},
    {key:'lowest',label:'最低',value:stats.minimum?.value,period:stats.minimum?.period},
    {key:'mean',label:'平均',value:stats.mean},
    {key:'median',label:'中位數',value:stats.median}
  ];
  return <section className="statistics-dashboard__panel statistics-dashboard__panel--chart"
    aria-label={title} style={{minWidth:0}}>
    <header className="statistics-dashboard__panel-heading">
      <h3>{title}</h3>
      <p>{range.startDate&&range.endDate
        ?range.startDate+' ～ '+range.endDate+' · 已完成期間的作品數':'僅分析已取得的總數資料'}</p>
    </header>
    <div className="statistics-dashboard__kpis" aria-label="極值與典型值">
      {metric.map(item=><div key={item.key} className="statistics-dashboard__kpi">
        <span className="statistics-dashboard__kpi-label">{item.label}</span>
        <strong className="statistics-dashboard__kpi-value">
          {item.value===undefined?'—':amount(item.value)}
        </strong>
        {item.period?<span className="scope-status">{item.period}</span>:null}
      </div>)}
    </div>
    {stats.entries.length?<div style={{width:'100%',height:320,minWidth:0}}
      role="group" aria-label="總數、平均、中位數與變化點折線圖">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={stats.entries.map(row=>({...row,period:row.period}))}
          margin={{top:18,right:24,bottom:20,left:0}}>
          <CartesianGrid stroke="var(--loc-line)" strokeDasharray="3 3"/>
          <XAxis dataKey="period" stroke="var(--loc-line)"
            tick={{fill:'var(--loc-text)',fontSize:11}} minTickGap={24}/>
          <YAxis stroke="var(--loc-line)" allowDecimals={false}
            tick={{fill:'var(--loc-text)',fontSize:11}}/>
          <Tooltip contentStyle={{background:'var(--loc-panel)',color:'var(--loc-text)',
            border:'1px solid var(--loc-line)',borderRadius:8}}/>
          <ReferenceLine y={stats.mean} stroke="var(--loc-accent)"
            strokeDasharray="6 4" label={{value:'平均',position:'insideTopRight',
              fill:'var(--loc-text)',fontSize:10}}/>
          {Math.abs(stats.mean-stats.median)>.001?<ReferenceLine y={stats.median}
            stroke="var(--loc-text)" strokeDasharray="2 5"
            label={{value:'中位',position:'insideBottomRight',
              fill:'var(--loc-text)',fontSize:10}}/>:null}
          {insight.detected&&insight.boundary?<ReferenceLine
            x={insight.boundary} stroke="var(--loc-accent)" strokeWidth={2}
            strokeDasharray="3 4"/>:null}
          <Line type="linear" dataKey="value" name="作品數" stroke="var(--loc-accent)"
            strokeWidth={3} dot={stats.entries.length<=32} isAnimationActive={false}/>
          {stats.maximum?<ReferenceDot x={stats.maximum.period} y={stats.maximum.value}
            r={5} fill="var(--loc-accent)" stroke="var(--loc-panel)"
            label={{value:'最高',position:'top',fill:'var(--loc-text)',fontSize:11}}/>:null}
          {stats.minimum?<ReferenceDot x={stats.minimum.period} y={stats.minimum.value}
            r={5} fill="var(--loc-text)" stroke="var(--loc-panel)"
            label={{value:'最低',position:'bottom',fill:'var(--loc-text)',fontSize:11}}/>:null}
        </LineChart>
      </ResponsiveContainer>
    </div>:<p className="scope-status">所選時期沒有可分析的作品總數。</p>}
    <div role="status" aria-live="polite" className="scope-status">
      <strong>PELT Insight · </strong>
      {pending?'正在分析已載入的時間分布…'
        :workerError?'變化點分析未完成；平均、中位數和原始圖表仍可使用。'
        :insightText(insight)}
    </div>
    {activeCount>1?<div className="statistics-dashboard__panel" style={{display:'grid',gap:12}}>
      <label style={{display:'grid',gap:8}}>
        <span>極端期間比較：前 {upCount} ／後 {downCount}</span>
        <input type="range" min="1" max="9" step="1" value={topCount}
          onChange={event=>setTopCount(Number(event.target.value))}
          aria-label="調整最高與最低期間的顯示比例"/>
      </label>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:14}}>
        <div><strong>最高期間</strong>
          <ol>{top.map(row=><li key={row.period}>{row.period} · {amount(row.value)}</li>)}</ol>
        </div>
        <div><strong>最低期間</strong>
          <ol>{bottom.map(row=><li key={row.period}>{row.period} · {amount(row.value)}</li>)}</ol>
        </div>
      </div>
    </div>:null}
    <p className="scope-status" role="note">
      PELT 偵測的是分布改變，不推測原因；沒有明確切點時不會虛構趨勢。
      統計不載入來源分類、文章本文或多媒體。
    </p>
  </section>;
}
