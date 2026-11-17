'use client';

import {useMemo} from 'react';
import {realMoonPhase} from '../loc/model/moon-phase';

const WEEKDAYS=['日','一','二','三','四','五','六'];

function dateKey(year,month,day){
  return year+'-'+String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0');
}

function phaseAt(date){
  return realMoonPhase(new Date(date+'T12:00:00+08:00'));
}

function offsetDate(date,days){
  const value=new Date(date+'T12:00:00+08:00');
  value.setDate(value.getDate()+days);
  return value.toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'});
}

function phaseMarkers(date){
  const current=phaseAt(date);
  if(!current||current==='未知')return [];
  const previous=phaseAt(offsetDate(date,-1));
  const next=phaseAt(offsetDate(date,1));
  const markers=[];
  if(previous!==current)markers.push(current+'開始');
  if(next!==current)markers.push(current+'結束');
  return markers;
}

export default function DailyRuneCalendar({
  year,
  month,
  rows=[],
  showDetails=true,
  selectedDate='',
  loading=false,
  canPrevious=true,
  onPrevious,
  onNext,
  onSelectDate
}){
  const byDate=useMemo(()=>{
    const grouped=new Map();
    for(const row of rows){
      const key=String(row.record_date||'').slice(0,10);
      if(!grouped.has(key))grouped.set(key,[]);
      grouped.get(key).push(row);
    }
    return grouped;
  },[rows]);

  const cells=useMemo(()=>{
    const firstWeekday=new Date(Date.UTC(year,month-1,1)).getUTCDay();
    const dayCount=new Date(Date.UTC(year,month,0)).getUTCDate();
    return [...Array(firstWeekday).fill(null),...Array.from({length:dayCount},(_,index)=>index+1)];
  },[year,month]);

  const monthLabel=year+' 年 '+month+' 月';

  return <section className="loc-card daily-log-calendar" aria-label="每日符文行事曆">
    <div className="scope-daily-calendar-nav">
      <button className="loc-button" type="button" disabled={!canPrevious||loading} onClick={onPrevious} aria-label="上個月">‹</button>
      <h2 aria-live="polite">{monthLabel}</h2>
      <button className="loc-button" type="button" disabled={loading} onClick={onNext} aria-label="下個月">›</button>
    </div>
    <div role="group" aria-label={monthLabel} className="scope-daily-calendar-grid">
      {WEEKDAYS.map((day,index)=><div aria-hidden="true" key={'weekday-'+index} className="scope-daily-calendar-weekday">{day}</div>)}
      {cells.map((day,index)=>{
        if(!day)return <div aria-hidden="true" key={'blank-'+index}/>;
        const key=dateKey(year,month,day);
        const entries=showDetails?(byDate.get(key)||[]):[];
        const main=entries.some(row=>row.draw_kind==='main');
        const supplement=entries.some(row=>row.draw_kind==='supplement');
        const selected=selectedDate===key;
        const moonMarkers=showDetails?phaseMarkers(key):[];
        return <button
          key={key}
          type="button"
          aria-pressed={selected}
          aria-label={key.replaceAll('-','/')+(moonMarkers.length?'，'+moonMarkers.join('，'):'')+(main?'，主抽':'')+(supplement?'，補抽':'')}
          onClick={()=>onSelectDate?.(key)}
          className={"scope-daily-calendar-cell"+(entries.length?" has-entry":"")}
        >
          <span className="scope-daily-calendar-day">{day}</span>
          <span className="scope-daily-calendar-flags">
            {moonMarkers.map(marker=><span key={marker}>{marker}</span>)}
            {main?<span>主抽</span>:null}{supplement?<span>補抽</span>:null}
          </span>
        </button>;
      })}
    </div>
  </section>;
}
