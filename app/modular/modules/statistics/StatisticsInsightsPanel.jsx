'use client';

import {useEffect,useMemo,useState} from 'react';
import {motion,useReducedMotion} from 'motion/react';
import {AnimatedNumber} from './StatisticsDashboardKpis';
import {
  Bar,BarChart,CartesianGrid,Line,LineChart,ReferenceDot,ReferenceLine,
  ResponsiveContainer,Tooltip,XAxis,YAxis
} from 'recharts';
import {explainPeltChange,rankInsightPeriods,totalPeriodStats} from './statistics-insights.mjs';
import StatisticsChartFrame from './StatisticsChartFrame';
import {visualColor} from '../../visual-palette.mjs';

const amount=value=>Number(value||0).toLocaleString('zh-TW',{
  maximumFractionDigits:1
});
const insightText=(insight,subject='作品')=>{
  if(!insight.detected)return '目前沒有偵測到明確的結構性變化；短期波動不代表趨勢。';
  const change=insight.direction==='up'?'上升':insight.direction==='down'?'下降':'持平';
  const ratio=insight.changePercent===null
    ?'（前段平均為零，無法計算百分比）'
    :'（'+(insight.changePercent>0?'+':'')+insight.changePercent.toFixed(1)+'%）';
  return '從 '+insight.boundary+' 起，'+subject+'密度'+change+'。變化前每期平均 '+
    amount(insight.before)+'，變化後 '+amount(insight.after)+' '+ratio+'。';
};

function useStatisticsInsightData(rows){
  const completed=useMemo(()=>rows.filter(row=>row&&!row.partial),[rows]);
  const hasPartial=completed.length<rows.length;
  const stats=useMemo(()=>totalPeriodStats(completed),[completed]);
  const [points,setPoints]=useState([]);
  const [pending,setPending]=useState(false);
  const [workerError,setWorkerError]=useState(false);
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
  const insight=useMemo(()=>explainPeltChange(completed,points),[completed,points]);
  const ranked=useMemo(()=>rankInsightPeriods(completed,points),[completed,points]);
  return {completed,hasPartial,stats,pending,workerError,insight,ranked};
}

function StatisticsInsightsRailContent({analysis,showMethodologyNote=true,methodologyNote='統計起始只載入總數；選取時段後才載入來源分布。',title='Trend Outlook',measureLabel='作品',children=null}){
  const {hasPartial,stats,pending,workerError,insight,ranked}=analysis;
  const reduceMotion=useReducedMotion();
  const summaryText=pending
    ?'已完成 '+stats.total.toLocaleString()+' 篇的完整時段統計；正在計算變化點…'
    :workerError?'變化點分析未完成；平均、中位數和原始圖表仍可使用。'
      :insightText(insight,measureLabel);
  const [topCount,setTopCount]=useState(5);
  const activeCount=Math.min(10,stats.entries.length);
  const upCount=Math.min(topCount,activeCount);
  const downCount=Math.max(0,activeCount-upCount);
  const top=ranked.up.slice(0,upCount);
  const bottom=ranked.down.slice(0,downCount);
  const metric=[
    {key:'highest',label:'最高',value:stats.maximum?.value,period:stats.maximum?.period,color:visualColor(2)},
    {key:'lowest',label:'最低',value:stats.minimum?.value,period:stats.minimum?.period,color:visualColor(4)},
    {key:'mean',label:'平均',value:stats.mean,color:visualColor(1)},
    {key:'median',label:'中位數',value:stats.median,color:visualColor(3)}
  ];
  return <aside className="statistics-dashboard__panel statistics-dashboard__panel--insights"
    aria-label="趨勢分析與極值">
    <header className="statistics-dashboard__panel-heading statistics-dashboard__panel-heading--insights">
      <div className="statistics-dashboard__insights-heading-copy">
        <h3>{title}</h3>
        <p>極值與典型值</p>
      </div>
      <div role="status" aria-live="polite"
        className="scope-status statistics-dashboard__pelt-summary">
        <strong>ByPELT · </strong>
        <motion.span key={summaryText}
          initial={reduceMotion?false:{opacity:0,y:4}}
          animate={{opacity:1,y:0}}
          transition={reduceMotion?{duration:0}:{duration:.18,ease:'easeOut'}}>
          {summaryText}
        </motion.span>
      </div>
    </header>
    {children}
    <div className="statistics-dashboard__insight-overview">
      <div className="statistics-dashboard__insight-metrics" aria-label="極值與典型值">
        {metric.map(item=><div key={item.key} className="statistics-dashboard__kpi" style={{borderInlineStart:'3px solid '+item.color}}>
          <span className="statistics-dashboard__kpi-label">{item.label}</span>
          <strong className="statistics-dashboard__kpi-value"
            aria-label={item.value===undefined?'無資料':amount(item.value)}>
            {item.value===undefined?'—':<AnimatedNumber value={amount(item.value)}/>}
          </strong>
          {item.period?<span className="scope-status">{item.period}</span>:null}
        </div>)}
      </div>
    </div>
    {activeCount>1?<div className="statistics-dashboard__insight-ranking">
      <label style={{display:'grid',gap:8}}>
        <span>相對{ranked.segmented?' PELT 區段平均':'整體平均'}：上升 {top.length} ／低於 {bottom.length}</span>
        <input type="range" min="1" max="9" step="1" value={topCount}
          onChange={event=>setTopCount(Number(event.target.value))}
          aria-label="調整最高與最低期間的顯示比例"/>
      </label>
      <div className="statistics-dashboard__insight-ranking-columns">
        <div><strong>高於趨勢基準</strong>
          <ol>{top.map(row=><li key={row.period}>{row.period} · {amount(row.value)}（+{amount(row.deviation)}）</li>)}</ol>
        </div>
        <div><strong>低於趨勢基準</strong>
          <ol>{bottom.map(row=><li key={row.period}>{row.period} · {amount(row.value)}（−{amount(-row.deviation)}）</li>)}</ol>
        </div>
      </div>
    </div>:null}
    {showMethodologyNote?<p className="scope-status" role="note">
      PELT 偵測的是分布改變，不推測原因；沒有明確切點時不會虛構趨勢。
      {hasPartial?' 目前尚未結束的時段會顯示在曲線，但不納入峰谷、平均及 PELT 比較。':''}
      {methodologyNote}
    </p>:null}
  </aside>;
}

export function StatisticsInsightsRail({rows=[],showMethodologyNote=true,methodologyNote,title='Trend Outlook',measureLabel='作品'}){
  const analysis=useStatisticsInsightData(rows);
  return <StatisticsInsightsRailContent analysis={analysis}
    showMethodologyNote={showMethodologyNote} methodologyNote={methodologyNote}
    title={title} measureLabel={measureLabel}/>;
}

export default function StatisticsInsightsPanel({
  rows=[],range={},title='總量趨勢洞察',intent='trend',zoomLevel=0,
  onZoomLevelChange=null,idPrefix='scope-stat',showMethodologyNote=true,
  onPeriodClick=null,selectedPeriodKey='',relatedContent=null
}){
  // The current/partial bucket is visible on the chart but does not distort
  // PELT segmentation, median, minima or extrema.
  const reduceMotion=useReducedMotion();
  const analysis=useStatisticsInsightData(rows);
  const {stats,insight}=analysis;
  const comparisonRows=useMemo(()=>{
    const output=rows.map(row=>({
      ...row,period:String(row.period||''),value:Number(row.total)||0,sourceRow:row
    }));
    if(output.length>6)
      output.sort((a,b)=>b.value-a.value||a.period.localeCompare(b.period));
    return output;
  },[rows]);
  const comparisonHorizontal=comparisonRows.length>6;
  const TrendChart=rows.length>=6?LineChart:BarChart;
  const trendRows=useMemo(()=>rows.map(row=>({
    period:row.period,value:Number(row.total)||0,
    start_date:row.start_date,end_date:row.end_date,sourceRow:row
  })),[rows]);
  const trendMark=rows.length>=6
    ?<Line type="linear" dataKey="value" name="作品數" stroke={visualColor(0)}
      strokeWidth={3} dot={rows.length<=32} cursor={onPeriodClick?'pointer':undefined}
      isAnimationActive={!reduceMotion&&rows.length<=600} animationDuration={480} animationEasing="ease-out"/>
    :<Bar dataKey="value" name="作品數" fill={visualColor(0)} maxBarSize={44}
      cursor={onPeriodClick?'pointer':undefined}/>;
  const handlePeriodClick=event=>{
    const point=event?.activePayload?.find(entry=>entry?.payload)?.payload;
    const source=point?.sourceRow||point;
    if(source?.period){
      onPeriodClick?.(source);
      return;
    }
    const index=Number(event?.activeTooltipIndex);
    if(Number.isInteger(index)&&rows[index])onPeriodClick?.(rows[index]);
  };
  const comparisonChart=<BarChart data={comparisonRows}
    layout={comparisonHorizontal?'vertical':'horizontal'}
    onClick={onPeriodClick?handlePeriodClick:undefined}
    margin={{top:18,right:24,bottom:comparisonHorizontal?20:36,left:0}}>
    <CartesianGrid stroke="var(--loc-line)" strokeDasharray="3 3"/>
    {comparisonHorizontal
      ?<>
        <XAxis type="number" stroke="var(--loc-line)" allowDecimals={false}
          tick={{fill:'var(--loc-text)',fontSize:11}}/>
        <YAxis dataKey="period" type="category" width={124}
          tick={{fill:'var(--loc-text)',fontSize:11}} stroke="var(--loc-line)"/>
        {selectedPeriodKey?<ReferenceLine y={selectedPeriodKey} stroke={visualColor(6)}
          strokeWidth={2.5} strokeDasharray="5 3"/>:null}
        <ReferenceLine x={stats.mean} stroke={visualColor(1)} strokeWidth={1.5}
          strokeDasharray="6 4" label={{value:'平均',position:'insideTopRight',
            fill:'var(--loc-text)',fontSize:10}}/>
        {Math.abs(stats.mean-stats.median)>.001?<ReferenceLine x={stats.median}
          stroke={visualColor(3)} strokeWidth={1.5} strokeDasharray="2 5"
          label={{value:'中位',position:'insideBottomRight',
            fill:'var(--loc-text)',fontSize:10}}/>:null}
      </>
      :<>
        <XAxis dataKey="period" stroke="var(--loc-line)"
          tick={{fill:'var(--loc-text)',fontSize:11}} angle={0} height={36}/>
        <YAxis stroke="var(--loc-line)" allowDecimals={false}
          tick={{fill:'var(--loc-text)',fontSize:11}}/>
        {selectedPeriodKey?<ReferenceLine x={selectedPeriodKey} stroke={visualColor(6)}
          strokeWidth={2.5} strokeDasharray="5 3"/>:null}
        <ReferenceLine y={stats.mean} stroke={visualColor(1)} strokeWidth={1.5}
          strokeDasharray="6 4" label={{value:'平均',position:'insideTopRight',
            fill:'var(--loc-text)',fontSize:10}}/>
        {Math.abs(stats.mean-stats.median)>.001?<ReferenceLine y={stats.median}
          stroke={visualColor(3)} strokeWidth={1.5} strokeDasharray="2 5"
          label={{value:'中位',position:'insideBottomRight',
            fill:'var(--loc-text)',fontSize:10}}/>:null}
      </>}
    <Tooltip contentStyle={{background:'var(--loc-panel)',color:'var(--loc-text)',
      border:'1px solid var(--loc-line)',borderRadius:8}}/>
    <Bar dataKey="value" name="作品數" fill={visualColor(0)}
      maxBarSize={comparisonHorizontal?28:44}
      cursor={onPeriodClick?'pointer':undefined}/>
  </BarChart>;
  // Preserve the established Dashboard composition: a main chart and a
  // separate Insights rail. PELT adds analytical meaning, not a new layout.
  return <div className="statistics-dashboard__workspace" aria-label="作品總數 Dashboard">
    <section className="statistics-dashboard__panel statistics-dashboard__panel--chart"
      aria-label={title}>
      <header className="statistics-dashboard__panel-heading">
        <h3>{title}</h3>
        <p>{range.startDate&&range.endDate
          ?range.startDate+' ～ '+range.endDate:'僅分析已取得的總數資料'}</p>
      </header>
      <StatisticsChartFrame level={zoomLevel} onChange={onZoomLevelChange}
        range={range} idPrefix={idPrefix}>
    {rows.length?<div className="statistics-dashboard__trend-plot"
      role="group" aria-label={intent==='compare'?'作品數量比較圖':'總數、平均、中位數與變化點趨勢圖'}>
      <ResponsiveContainer width="100%" height="100%">
        {intent==='compare'?comparisonChart:
          <TrendChart data={trendRows}
            onClick={onPeriodClick?handlePeriodClick:undefined}
            margin={{top:18,right:24,bottom:20,left:0}}>
            <CartesianGrid stroke="var(--loc-line)" strokeDasharray="3 3"/>
            <XAxis dataKey="period" stroke="var(--loc-line)"
              tick={{fill:'var(--loc-text)',fontSize:11}}
              angle={rows.length>=6?-20:0} height={rows.length>=6?64:36} minTickGap={24}/>
            <YAxis stroke="var(--loc-line)" allowDecimals={false}
              tick={{fill:'var(--loc-text)',fontSize:11}}/>
            {selectedPeriodKey?<ReferenceLine x={selectedPeriodKey} stroke={visualColor(6)}
              strokeWidth={2.5} strokeDasharray="5 3"/>:null}
            <Tooltip contentStyle={{background:'var(--loc-panel)',color:'var(--loc-text)',
              border:'1px solid var(--loc-line)',borderRadius:8}}/>
            <ReferenceLine y={stats.mean} stroke={visualColor(1)} strokeWidth={1.5}
              strokeDasharray="6 4" label={{value:'平均',position:'insideTopRight',
                fill:'var(--loc-text)',fontSize:10}}/>
            {Math.abs(stats.mean-stats.median)>.001?<ReferenceLine y={stats.median}
              stroke={visualColor(3)} strokeWidth={1.5} strokeDasharray="2 5"
              label={{value:'中位',position:'insideBottomRight',
                fill:'var(--loc-text)',fontSize:10}}/>:null}
            {insight.detected&&insight.boundary?<ReferenceLine
              x={insight.boundary} stroke={visualColor(6)} strokeWidth={2}
              strokeDasharray="3 4"/>:null}
            {trendMark}
            {stats.maximum?<ReferenceDot x={stats.maximum.period} y={stats.maximum.value}
              r={6} fill={visualColor(2)} stroke="var(--loc-panel)"
              label={{value:'最高',position:'top',fill:'var(--loc-text)',fontSize:11}}/>:null}
            {stats.minimum?<ReferenceDot x={stats.minimum.period} y={stats.minimum.value}
              r={6} fill={visualColor(4)} stroke="var(--loc-panel)"
              label={{value:'最低',position:'bottom',fill:'var(--loc-text)',fontSize:11}}/>:null}
          </TrendChart>}
      </ResponsiveContainer>
    </div>:<p className="scope-status">所選時期沒有可分析的作品總數。</p>}
      </StatisticsChartFrame>
    </section>
    <StatisticsInsightsRailContent analysis={analysis}
      showMethodologyNote={showMethodologyNote}
      methodologyNote="統計起始只載入總數；選取時段後才載入來源分布。"
      measureLabel="作品"
      title="Trend Outlook">
      {relatedContent}
    </StatisticsInsightsRailContent>
  </div>;
}
