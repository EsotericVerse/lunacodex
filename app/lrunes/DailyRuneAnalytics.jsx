'use client';

import {useMemo,useState} from 'react';
import dynamic from 'next/dynamic';
import {useFeatureCopy} from '../i18n/ui-locale';
import featureZh from '../i18n/feature-sections/dailyRune.zh_tw.js';
import {useAsyncResource} from '../loc/use-async-resource';
import {
  Bar,BarChart,CartesianGrid,ComposedChart,LabelList,Line,
  Tooltip,XAxis,YAxis
} from 'recharts';
import {selectDailyRuneRange,selectFirstDailyRuneDate} from '../loc/daily-runes';
import {realMoonPhase} from '../loc/model/moon-phase';
import CultureTimeline from '../modular/modules/culture-timeline/CultureTimeline';
import {availableStatisticChartTypes} from '../modular/modules/statistics/statistics-time-zoom.mjs';
const StatisticsMultiChart=dynamic(()=>import('../modular/modules/statistics/StatisticsMultiChart'),{loading:()=>null});
import StatisticsChartFrame from '../modular/modules/statistics/StatisticsChartFrame';
import StatisticsDetails from '../modular/modules/statistics/StatisticsDetails';
import {statisticsZoomWindow} from '../modular/modules/statistics/statistics-time-zoom.mjs';
import {DEFAULT_YEAR_WINDOW} from '../loc/default-year-window.mjs';
import {
  DAILY_RUNE_MODES,normalizeDailyDraws,rankDailyDraws,pageDailyRanking,
  summarizeDailyDraws,dailyCategoryTrend,dailyDirectionTrend
} from './daily-analytics-model.mjs';

const PHASE_DATE_TIME='T12:00:00+08:00';
const FOCUS=Object.freeze({});
const DRAW_ORDER=Object.freeze({main:0,supplement:1,history_1:2,history_2:3});
const TIME_OPTION_KEYS=Object.freeze({ '1y':'lastYear','1m':'lastMonth','1w':'lastWeek',custom:'customRange'});
const MODE_KEYS=Object.freeze({rune:'rune',direction:'direction'});

function todayInTaipei(){
  try{
    const parts=new Intl.DateTimeFormat('en-CA',{
      timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'
    }).formatToParts(new Date());
    const items=Object.fromEntries(parts.filter(item=>item.type!=='literal').map(item=>[item.type,item.value]));
    return items.year+'-'+items.month+'-'+items.day;
  }catch{return new Date().toISOString().slice(0,10);}
}
function offsetDate(day,{months=0,days=0}={}){
  const date=new Date(day+'T00:00:00Z');
  if(months)date.setUTCMonth(date.getUTCMonth()+months);
  if(days)date.setUTCDate(date.getUTCDate()+days);
  return date.toISOString().slice(0,10);
}
function resolveRange(mode,customFrom,customTo){
  if(mode==='year')return {startDate:DEFAULT_YEAR_WINDOW.startDate,
    endDate:DEFAULT_YEAR_WINDOW.endDate};
  const today=todayInTaipei();
  if(mode==='custom'){
    const from=String(customFrom||'').slice(0,10);
    const to=String(customTo||'').slice(0,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to)return null;
    return {startDate:from,endDate:to};
  }
  return {
    startDate:mode==='1m'?offsetDate(today,{months:-1}):mode==='1w'?offsetDate(today,{days:-6}):offsetDate(today,{months:-12}),
    endDate:today
  };
}
function useDailyRuneWindow(mode,customFrom,customTo){
  const range=useMemo(()=>resolveRange(mode,customFrom,customTo),[mode,customFrom,customTo]);
  const query=useAsyncResource(['lrunes-daily-analytics',range?.startDate,range?.endDate],
    ()=>selectDailyRuneRange(range),{enabled:Boolean(range)});
  const draws=useMemo(()=>normalizeDailyDraws(query.data||[],date=>
    realMoonPhase(new Date(date+PHASE_DATE_TIME))
  ),[query.data]);
  return {range,query,draws};
}
function RangeControls({mode,setMode,from,setFrom,to,setTo}){
  const text=useFeatureCopy('dailyRune',featureZh);
  return <div className="scope-stat-controls">
    <label><span>{text.range}</span>
      <select className="scope-select" value={mode} onChange={event=>setMode(event.target.value)}>
        <option value="year">{DEFAULT_YEAR_WINDOW.label}</option>
        {Object.entries(TIME_OPTION_KEYS).map(([value,key])=><option key={value} value={value}>{text[key]}</option>)}
      </select>
    </label>
    {mode==='custom'?<>
      <label><span>{text.start}</span><input className="scope-input" type="date" value={from} onChange={event=>setFrom(event.target.value)}/></label>
      <label><span>{text.end}</span><input className="scope-input" type="date" value={to} onChange={event=>setTo(event.target.value)}/></label>
    </>:null}
  </div>;
}
function queryMessage(query,range,text){
  if(!range)return text.invalidRange;
  if(query.error)return text.readError+String(query.error?.message||query.error);
  if(query.isPending)return text.reading;
  return '';
}
function groupLabel(row,text){
  return ({main:text.drawMain,supplement:text.drawSupplement,history_1:text.historyOne,history_2:text.historyTwo})[row.draw_kind]||text.otherHistory;
}
function nextDay(date){return offsetDate(date,{days:1});}
function riverLabel(row){return String(row?.display_label||'');}

export function LrunesDailyCulturePanel(){
  const text=useFeatureCopy('dailyRune',featureZh);
  const [mode,setMode]=useState('year');
  const [from,setFrom]=useState('');
  const [to,setTo]=useState('');
  const [selected,setSelected]=useState(null);
  const {range,query,draws}=useDailyRuneWindow(mode,from,to);
  const summary=useMemo(()=>summarizeDailyDraws(draws),[draws]);
  const drawItems=useMemo(()=>draws.map((row,index)=>({
    id:'daily-rune:'+row.record_date+':'+row.draw_kind+':'+index,
    entry_id:'daily-rune:'+row.record_date+':'+row.draw_kind+':'+index,
    entry_type:'daily_rune',
    group_label:groupLabel(row,text),
    group_order:DRAW_ORDER[row.draw_kind]??4,
    start_date:row.record_date,
    end_date:nextDay(row.record_date),
    display_label:row.rune_name+' · '+row.direction+' · '+row.phase,
    title:row.record_date+' · '+groupLabel(row,text)+' · '+row.rune_name+' · '+row.direction+' · '+row.phase+(row.phase_inferred?text.inferredRecord:''),
    item_count:1,
    daily_record:row
  })),[draws,text]);
  const message=queryMessage(query,range,text);
  return <section className="scope-card scope-culture-classification-river">
    <h3>{text.riverTitle}</h3>
    <RangeControls mode={mode} setMode={setMode} from={from} setFrom={setFrom} to={to} setTo={setTo}/>
    {message?<p className="scope-status">{message}</p>:null}
    {!message?<p className="scope-status">{range.startDate} ～ {range.endDate} · {summary.dayCount}{text.days}{summary.recordCount}{text.drawRecords}</p>:null}
    {range&&drawItems.length?<CultureTimeline
      items={drawItems}
      labelOf={riverLabel}
      focus={FOCUS}
      mode="source"
      windowStart={range.startDate}
      windowEnd={nextDay(range.endDate)}
      onSelect={item=>setSelected(item?.raw?.daily_record||null)}
    />:null}
    {selected?<p className="scope-status">{text.selectedRecord}{selected.record_date} · {groupLabel(selected,text)} · {selected.rune_name} · {selected.direction} · {selected.phase}{selected.phase_inferred?text.inferredDate:''}</p>:null}
  </section>;
}

export function LrunesDailyStatisticsPanel(){
  const text=useFeatureCopy('dailyRune',featureZh);
  const [zoomLevel,setZoomLevel]=useState(0);
  const today=useMemo(()=>todayInTaipei(),[]);
  const earliest=useAsyncResource(['statistics-history-start','daily-rune'],()=>
    selectFirstDailyRuneDate());
  const zoomRange=useMemo(()=>{
    const normal=statisticsZoomWindow(zoomLevel,DEFAULT_YEAR_WINDOW.endDate,earliest.data||'');
    return zoomLevel===0?{...normal,startDate:DEFAULT_YEAR_WINDOW.startDate,
      endDate:DEFAULT_YEAR_WINDOW.endDate,bucket:'month',canZoomOut:false,
      canZoomIn:true}:normal;
  },[zoomLevel,earliest.data]);
  const [analysisMode,setAnalysisMode]=useState('rune');
  const [page,setPage]=useState(1);
  const [chart,setChart]=useState('bar');
  const {range,query,draws}=useDailyRuneWindow('custom',zoomRange.startDate,zoomRange.endDate);
  const isDirection=analysisMode==='direction';
  const ranking=useMemo(()=>rankDailyDraws(draws,'rune'),[draws]);
  const pagination=useMemo(()=>pageDailyRanking(ranking,page),[ranking,page]);
  const summary=useMemo(()=>summarizeDailyDraws(draws),[draws]);
  const featured=useMemo(()=>ranking.slice(0,5),[ranking]);
  const timeline=useMemo(()=>dailyCategoryTrend(draws,'rune',featured,zoomRange.bucket,range?.startDate,range?.endDate),[draws,featured,zoomRange.bucket,range?.startDate,range?.endDate]);
  const directionTimeline=useMemo(()=>dailyDirectionTrend(draws,zoomRange.bucket,range?.startDate,range?.endDate),[draws,zoomRange.bucket,range?.startDate,range?.endDate]);
  const bars=useMemo(()=>ranking.slice(0,15).map(row=>({label:row.label,value:row.count})),[ranking]);
  const runeSeries=featured.map(row=>({key:row.key,label:row.label}));
  const runeCategories=ranking.slice(0,15).map(row=>({name:row.label,value:row.count}));
  const chartOptions=availableStatisticChartTypes({rows:timeline,series:runeSeries,distribution:runeCategories});
  const availableCharts=[{value:'bar',label:text.rankingBar},...chartOptions.filter(([id])=>id!=='bar').map(([value,label])=>({value,label}))];
  const selectedChart=availableCharts.some(item=>item.value===chart)?chart:'bar';
  const message=queryMessage(query,range,text);
  return <>
    <div className="scope-stat-controls">
      <label><span>{text.analyticsMode}</span>
        <select className="scope-select" value={analysisMode} onChange={event=>{setAnalysisMode(event.target.value);setPage(1);}}>
          {DAILY_RUNE_MODES.map(option=><option key={option.value} value={option.value}>{text[MODE_KEYS[option.value]]||option.label}</option>)}
        </select>
      </label>
      {!isDirection?<label><span>{text.chart}</span>
        <select className="scope-select" value={selectedChart} onChange={event=>setChart(event.target.value)}>
          {availableCharts.map(item=><option value={item.value} key={item.value}>{item.label}</option>)}
        </select>
      </label>:null}
    </div>
    {message?<p className="scope-status">{message}</p>:null}
    {!message?<>
      <p className="scope-status">{range.startDate} ～ {range.endDate} · {summary.dayCount}{text.days}{summary.recordCount}{text.drawCount}</p>
      {isDirection?<StatisticsChartFrame level={zoomLevel} onChange={setZoomLevel} range={zoomRange} idPrefix="daily-rune-stat">
        {!summary.recordCount?<p className="scope-status">{text.empty}</p>:<ComposedChart responsive style={{width:"100%",height:360}}
             data={directionTimeline} margin={{top:30,right:24,bottom:8,left:4}}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--loc-line)"/>
            <XAxis dataKey="period" tick={{fill:'var(--loc-text)'}}/>
            <YAxis yAxisId="count" allowDecimals={false} width={42} tick={{fill:'var(--loc-text)'}}/>
            <YAxis yAxisId="direction" orientation="right" domain={[-1,1]} ticks={[-1,-0.5,0,0.5,1]} width={52} tick={{fill:'var(--loc-text)'}} tickFormatter={value=>value>0?'+'+value:value}/>
            <Tooltip contentStyle={{background:'var(--loc-panel)',border:'1px solid var(--loc-line)',color:'var(--loc-text)'}} formatter={(value,name,row)=>name===text.direction?[Number(value).toFixed(2)+' · '+(row?.payload?.directionLabels||''),name]:[value,name]}/>
            <Bar yAxisId="count" dataKey="recordCount" name={text.extractions} fill="var(--loc-accent)" radius={[4,4,0,0]}/>
            <Line yAxisId="direction" type="monotone" dataKey="directionAverage" name={text.direction} stroke="#e1a64b" strokeWidth={3} connectNulls={false} dot={{r:4}}>
              <LabelList dataKey="runeLabels" position="top" content={({x,y,value})=>value?<text x={x} y={y-9} textAnchor="middle" fill="var(--loc-text)" fontSize={11}>{String(value).length>12?String(value).slice(0,12)+'…':value}</text>:null}/>
            </Line>
          </ComposedChart>}
      </StatisticsChartFrame>:!ranking.length?<StatisticsChartFrame level={zoomLevel} onChange={value=>{setZoomLevel(value);setPage(1);}} range={zoomRange} idPrefix="daily-rune-stat">
        <p className="scope-status">{text.empty}</p>
      </StatisticsChartFrame>:<>
      <StatisticsChartFrame level={zoomLevel} onChange={value=>{setZoomLevel(value);setPage(1);}} range={zoomRange} idPrefix="daily-rune-stat">
      {selectedChart==='bar'?<BarChart responsive style={{width:"100%",height:Math.max(220,bars.length*29+50)}}
           data={bars} layout="vertical" margin={{top:8,right:16,bottom:8,left:4}}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--loc-line)"/>
          <XAxis type="number" allowDecimals={false} tick={{fill:'var(--loc-text)'}}/>
          <YAxis type="category" dataKey="label" width={82} tick={{fill:'var(--loc-text)',fontSize:12}}/>
          <Tooltip contentStyle={{background:'var(--loc-panel)',border:'1px solid var(--loc-line)',color:'var(--loc-text)'}}/>
          <Bar dataKey="value" name={text.extractions} fill="var(--loc-accent)" radius={[0,4,4,0]}/>
        </BarChart>:<StatisticsMultiChart
        type={selectedChart} rows={timeline} series={runeSeries} distribution={runeCategories} height={360}
      />}
      </StatisticsChartFrame>
      <StatisticsDetails>{()=><>
<div className="scope-ranking">
        {pagination.rows.map((row,index)=><div key={row.key}>
          <strong>{(pagination.currentPage-1)*pagination.pageSize+index+1}. {row.label}</strong>
          <span>{row.count.toLocaleString()}{text.times}{row.ratio.toFixed(1)}%</span>
        </div>)}
      </div>
      {pagination.totalPages>1?<nav className="scope-stat-controls" aria-label={text.rankingPages}>
        <button type="button" className="loc-button" disabled={pagination.currentPage===1} onClick={()=>setPage(current=>Math.max(1,current-1))}>{text.previous}</button>
        <span className="scope-status">{text.page}{pagination.currentPage} / {pagination.totalPages}{text.pageSize}</span>
        <button type="button" className="loc-button" disabled={pagination.currentPage===pagination.totalPages} onClick={()=>setPage(current=>Math.min(pagination.totalPages,current+1))}>{text.next}</button>
      </nav>:null}
      </>}</StatisticsDetails></>}
    </>:null}
  </>;
}
