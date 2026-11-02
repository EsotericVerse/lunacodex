'use client';

import {useEffect,useMemo,useState} from 'react';
import DailyRuneCalendar from './DailyRuneCalendar';
import {selectDailyRuneMonth} from '../loc/daily-runes';
import {useAccount} from '../loc/use-account';

// Settings is a read-only calendar display; daily records and their editors are untouched.
function monthNow(){
  const parts=new Intl.DateTimeFormat('en-US',{
    timeZone:'Asia/Taipei',year:'numeric',month:'numeric'
  }).formatToParts(new Date());
  const n=Object.fromEntries(parts.filter(x=>x.type!=='literal').map(x=>[x.type,Number(x.value)]));
  return n.year*12+n.month-1;
}

export default function DailyRuneCalendarSettings(){
  const {user,loading:accountLoading}=useAccount({sessionOnly:true});
  const [monthValue,setMonthValue]=useState(monthNow);
  const [rows,setRows]=useState([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const year=Math.floor(monthValue/12),month=monthValue%12+1;
  const canLoad=!accountLoading&&Boolean(user);
  useEffect(()=>{
    let active=true;
    setRows([]);
    setError('');
    if(!canLoad)return ()=>{active=false;};
    setLoading(true);
    selectDailyRuneMonth({year,month}).then(data=>{
      if(active)setRows(Array.isArray(data)?data:[]);
    }).catch(reason=>{
      if(active)setError(String(reason?.message||reason||'行事曆讀取失敗'));
    }).finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[canLoad,year,month]);
  const earliest=2026*12+7;
  const date=useMemo(()=>year+'-'+String(month).padStart(2,'0'),[year,month]);
  return <section className="loc-settings-panel-group" aria-label="每日符文行事曆">
    <DailyRuneCalendar year={year} month={month} rows={rows}
      showDetails={canLoad} loading={loading}
      canPrevious={monthValue>earliest}
      onPrevious={()=>setMonthValue(value=>Math.max(earliest,value-1))}
      onNext={()=>setMonthValue(value=>value+1)}/>
    {!accountLoading&&!user?<p className="scope-status">登入後顯示每日符文紀錄。</p>:null}
    {error?<p className="scope-status scope-error" role="status">{date}：{error}</p>:null}
  </section>;
}
