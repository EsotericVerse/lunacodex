'use client';

import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import DailyRuneCalendar from '../../lrunes/DailyRuneCalendar';
import {dailyRecordSlots,availableDailyRuneKind} from './daily-record-slots.mjs';
import {Capacitor} from '@capacitor/core';
import DailyRuneTransfer from '../../lrunes/DailyRuneTransfer';
import ContextReturnNav from '../../modular/ContextReturnNav';
import RuneCardInfo from '../../lrunes/RuneCardInfo';
import {runeImage} from '../../lrunes/rune-directory.mjs';
import {
  deleteDailyRuneRecord,
  insertDailyRuneRecord,
  selectDailyRuneMonth,
  selectPreviousDailyRuneOccurrence,
  selectDailyRuneContext,
  selectDailyRuneSituation,
  updateDailyRuneRecord
} from '../../loc/daily-runes';
import {selectRows} from '../../loc/db-query.mjs';
import {lRunes66ColumnString} from '../../../zenstack/lrunes-read-model.mjs';
import {useAccount} from '../../loc/use-account';
import {useResourceCache} from '../../../zenstack/client-queries';
import {listLocalDailyRunes,importLocalDailyTransfer,updateLocalDailyRune,deleteLocalDailyRune} from '../../lrunes/local-rune-records.mjs';

const FIRST_MONTH=2026*12+7;
const EMPTY_ROWS=Object.freeze([]);
const DIRECTIONS=['正位','半正位','半逆位','逆位'];
const DIRECTION_ROTATION=Object.freeze({
  '正位':'rune-rotate-0',
  '半正位':'rune-rotate-90',
  '半逆位':'rune-rotate-n90',
  '逆位':'rune-rotate-180'
});

function taipeiParts(date=new Date()){
  try{
    const parts=new Intl.DateTimeFormat('en-US',{
      timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'
    }).formatToParts(date);
    return Object.fromEntries(parts.filter(part=>part.type!=='literal').map(part=>[part.type,part.value]));
  }catch{
    return {
      year:String(date.getFullYear()),
      month:String(date.getMonth()+1).padStart(2,'0'),
      day:String(date.getDate()).padStart(2,'0')
    };
  }
}
function taipeiToday(){
  const parts=taipeiParts();
  return parts.year+'-'+parts.month+'-'+parts.day;
}
function currentMonthValue(){
  const parts=taipeiParts();
  return Number(parts.year)*12+(Number(parts.month)-1);
}
function monthParts(value){return {year:Math.floor(value/12),month:value%12+1};}
function dateKey(year,month,day){return year+'-'+String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0');}
function formatDate(value){return String(value||'').slice(0,10).replaceAll('-','/');}
function monthValueOf(date){
  const [year,month]=String(date||'').slice(0,7).split('-').map(Number);
  return year&&month?year*12+(month-1):currentMonthValue();
}
function rowKey(row){
  return String(row.record_date||'').slice(0,10)+'|'+String(row.draw_kind||'');
}

export default function DailyLogClient({embedded=false}={}){
  const sessionAccount=useAccount({sessionOnly:true});
  const resourceCache=useResourceCache();
  const invalidateDailyCharts=()=>Promise.all([
    resourceCache.invalidate({queryKey:['lrunes-daily-analytics']}),
    resourceCache.invalidate({queryKey:['statistics-history-start','daily-rune']})
  ]);
  const [native,setNative]=useState(false);
  useEffect(()=>{setNative(Capacitor.isNativePlatform());},[]);
  // Reading daily records only needs a session. Fetch the shared Scope
  // authorizer only for signed-in cloud users who could write.
  const managementAccount=useAccount({enabled:!native&&Boolean(sessionAccount.user)});
  const canViewDetails=native||(!sessionAccount.loading&&Boolean(sessionAccount.user)&&!managementAccount.loading&&!managementAccount.permissionLoading);
  const monthRequest=useRef(0);
  const [monthValue,setMonthValue]=useState(()=>Math.max(FIRST_MONTH,currentMonthValue()));
  const [rows,setRows]=useState([]);
  const [selectedDate,setSelectedDate]=useState(()=>taipeiToday());
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(false);
  const [runes,setRunes]=useState([]);
  const [message,setMessage]=useState('');
  const [saving,setSaving]=useState(false);
  const [editingKey,setEditingKey]=useState('');
  const [editForm,setEditForm]=useState(null);
  const [comparisons,setComparisons]=useState([]);
  const [comparisonLoading,setComparisonLoading]=useState(false);
  const [newForm,setNewForm]=useState(()=>({
    recordDate:taipeiToday(),
    drawKind:'main',
    runeNumber:'1',
    direction:'正位'
  }));
  const {year,month}=monthParts(monthValue);
  const canWrite=native||(canViewDetails&&managementAccount.canLocAccessSync('scope','lrunes'));
  // Calendar dates remain public in the UI; no rune data is queried without login.
  const visibleRows=canViewDetails?rows:EMPTY_ROWS;
  // Settings and the standalone log must share identical editing permissions.
  const selectedMonthReady=canViewDetails&&!loading&&!error&&
    monthValueOf(newForm.recordDate)===monthValue;
  const occupiedSlots=useMemo(
    ()=>dailyRecordSlots(visibleRows,newForm.recordDate),
    [visibleRows,newForm.recordDate]
  );
  const dateIsFull=selectedMonthReady&&occupiedSlots.main&&occupiedSlots.supplement;
  const kindOccupied=selectedMonthReady&&occupiedSlots[newForm.drawKind];

  useEffect(()=>{
    if(!canWrite||!selectedMonthReady)return;
    setNewForm(current=>{
      const kind=availableDailyRuneKind(visibleRows,current.recordDate,current.drawKind);
      return kind===current.drawKind?current:{...current,drawKind:kind};
    });
  },[canWrite,selectedMonthReady,visibleRows,newForm.recordDate]);

  const loadMonth=useCallback(async()=>{
    const request=++monthRequest.current;
    if(!canViewDetails){
      setRows([]);
      setError('');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try{
      const result=native?[]:await selectDailyRuneMonth({year,month});
      // Scope personnel can additionally see device-only daily records here.
      // They are not synced into canonical silver.lrunes_daily.
      const local=canWrite?await listLocalDailyRunes():[];
      if(monthRequest.current!==request)return;
      const byKey=new Map((result||[]).map(row=>[rowKey(row),row]));
      const runeIds=[...new Set(local.map(row=>Number(row.rune_number)))];
      const runeRows=runeIds.length&&!native?await selectRows('silver.runes',{
        columns:lRunes66ColumnString('rune_id','rune_name','english_name','totem','group_name','moon_phase','card_attr','rune_description','archetype','positive_keywords','negative_keywords'),
        filters:[{column:'rune_id',operator:'in',value:runeIds}],limit:runeIds.length
      }):{rows:[]};
      if(monthRequest.current!==request)return;
      const metadata=new Map((runeRows.rows||[]).map(item=>[Number(item.rune_id),item]));
      for(const row of local){
        if(String(row.record_date).slice(0,7)!==dateKey(year,month,1).slice(0,7))continue;
        const rune=metadata.get(Number(row.rune_number))||{};
        // Server entries win any record-date/draw-kind collision.
        if(!byKey.has(rowKey(row)))byKey.set(rowKey(row),{
          ...row,...rune,rune_id:rune.rune_id??row.rune_number,
          rune_name:rune.rune_name||String(row.rune_number),local_only:true
        });
      }
      const merged=[...byKey.values()].sort((a,b)=>rowKey(a).localeCompare(rowKey(b)));
      setRows(merged);
      const today=taipeiToday();
      setSelectedDate(current=>{
        if(current&&current.slice(0,7)===dateKey(year,month,1).slice(0,7))return current;
        if(today.slice(0,7)===dateKey(year,month,1).slice(0,7))return today;
        return String(merged.at(-1)?.record_date||dateKey(year,month,1)).slice(0,10);
      });
    }catch(reason){
      if(monthRequest.current!==request)return;
      setRows([]);
      setError(String(reason?.message||reason||'讀取每日符文紀錄失敗。'));
    }finally{
      if(monthRequest.current===request)setLoading(false);
    }
  },[year,month,canViewDetails,canWrite,native]);

  useEffect(()=>{
    loadMonth();
    const reload=()=>loadMonth();
    window.addEventListener('loc-rune-local-changed',reload);
    return()=>{monthRequest.current+=1;window.removeEventListener('loc-rune-local-changed',reload);};
  },[loadMonth]);

  useEffect(()=>{
    if(!canViewDetails)return;
    let active=true;
    selectRows('silver.runes',{
      columns:lRunes66ColumnString('rune_id','rune_name'),
      orders:[{column:'rune_id',ascending:true}],
      limit:67,
      offset:0
    }).then(({rows})=>{
      if(!active)return;
      setRunes(rows||[]);
      if(rows?.length&&!rows.some(row=>String(row.rune_id)===String(newForm.runeNumber))){
        setNewForm(current=>({...current,runeNumber:String(rows[0].rune_id)}));
      }
    }).catch(reason=>setMessage(String(reason?.message||reason||'符文資料讀取失敗。')));
    return()=>{active=false;};
  },[canViewDetails]);

  const byDate=useMemo(()=>{
    const grouped=new Map();
    for(const row of visibleRows){
      const key=String(row.record_date).slice(0,10);
      if(!grouped.has(key))grouped.set(key,[]);
      grouped.get(key).push(row);
    }
    return grouped;
  },[visibleRows]);

  const selectedRows=useMemo(()=>byDate.get(selectedDate)||EMPTY_ROWS,[byDate,selectedDate]);

  useEffect(()=>{
    let active=true;
    async function loadComparisons(){
      if(!selectedDate||!selectedRows.length){
        setComparisons([]);
        return;
      }
      setComparisonLoading(true);
      try{
        const next=await Promise.all(selectedRows.map(async row=>{
          const previous=await selectPreviousDailyRuneOccurrence({
            runeNumber:row.rune_number,
            beforeDate:selectedDate
          });
          const currentContext=await selectDailyRuneContext({
            runeNumber:row.rune_number,
            direction:row.direction,
            recordDate:selectedDate
          });
          const previousSituation=previous?await selectDailyRuneSituation({
            runeNumber:previous.rune_number,
            direction:previous.direction,
            recordDate:previous.record_date
          }):null;
          return {key:rowKey(row),current:row,previous,currentContext,previousSituation};
        }));
        if(active)setComparisons(next);
      }catch{
        if(active)setComparisons([]);
      }finally{
        if(active)setComparisonLoading(false);
      }
    }
    loadComparisons();
    return()=>{active=false;};
  },[selectedDate,selectedRows]);


  async function addRecord(event){
    event.preventDefault();
    setSaving(true);setMessage('');
    try{
      if(!canWrite)throw new Error('目前沒有新增每日符文的權限。');
      if(kindOccupied)throw new Error('該日期已經有此類紀錄。請選擇尚未使用的類別或其他日期。');
      if(native){
        const result=await importLocalDailyTransfer([{
          record_date:newForm.recordDate,draw_kind:newForm.drawKind,
          rune_number:Number(newForm.runeNumber),direction:newForm.direction,recorded_phase:''
        }]);
        if(!result.newCount)throw new Error('該日期與類別已有本機紀錄，不會覆寫。');
      }else await insertDailyRuneRecord(newForm);
      const nextMonth=monthValueOf(newForm.recordDate);
      setSelectedDate(newForm.recordDate);
      if(nextMonth!==monthValue)setMonthValue(nextMonth);
      else await loadMonth();
      await invalidateDailyCharts();
      setMessage('已新增每日符文紀錄。');
    }catch(reason){
      setMessage(String(reason?.message||reason||'新增失敗。'));
    }finally{setSaving(false);}
  }

  function beginEdit(row){
    setEditingKey(rowKey(row));
    setEditForm({
      recordDate:String(row.record_date).slice(0,10),
      drawKind:row.draw_kind,
      runeNumber:String(row.rune_number),
      direction:row.direction
    });
    setMessage('');
  }

  async function saveEdit(event){
    event.preventDefault();
    if(!editForm)return;
    setSaving(true);setMessage('');
    try{
      if(native)await updateLocalDailyRune(editForm);
      else await updateDailyRuneRecord(editForm);
      await loadMonth();
      setEditingKey('');setEditForm(null);
      await invalidateDailyCharts();
      setMessage('已更新每日符文紀錄。');
    }catch(reason){
      setMessage(String(reason?.message||reason||'修改失敗。'));
    }finally{setSaving(false);}
  }

  async function removeRecord(row){
    if(!window.confirm('確定刪除這筆每日符文紀錄？'))return;
    setSaving(true);setMessage('');
    try{
      if(native)await deleteLocalDailyRune({recordDate:String(row.record_date).slice(0,10),drawKind:row.draw_kind});
      else await deleteDailyRuneRecord({
        recordDate:String(row.record_date).slice(0,10),drawKind:row.draw_kind
      });
      await loadMonth();
      await invalidateDailyCharts();
      setMessage('已刪除每日符文紀錄。');
    }catch(reason){
      setMessage(String(reason?.message||reason||'刪除失敗。'));
    }finally{setSaving(false);}
  }

  const Root=embedded?'section':'main';
  return <Root className={'loc-view'+(!embedded?' daily-rune-log-view':'')}>
    {!embedded?<ContextReturnNav scopeId="lrunes" label="回符文首頁"/>:null}
    {!embedded?<header className="loc-hero loc-hero-feature">
      <p className="loc-eyebrow">每日抽籤紀錄</p>
      <h1>每日符文抽籤紀錄</h1>
      <p>依日期保存每日符文的主抽與補抽，並在行事曆下方比較同一符文上一次出現的日期與當時狀況。</p>
    </header>:null}

    <DailyRuneCalendar
      year={year}
      month={month}
      rows={visibleRows}
      showDetails={canViewDetails}
      selectedDate={selectedDate}
      loading={loading}
      canPrevious={monthValue>FIRST_MONTH}
      onPrevious={()=>setMonthValue(value=>value-1)}
      onNext={()=>setMonthValue(value=>value+1)}
      onSelectDate={setSelectedDate}
    />

    {canViewDetails&&selectedRows.length?<section className="loc-card" aria-live="polite">
      <p className="loc-eyebrow">每日符文說明</p>
      <h2>{formatDate(selectedDate)} 的當日指引與前次紀錄</h2>
      {comparisonLoading?<p className="loc-status">讀取前次同符文紀錄…</p>:null}
      {!comparisonLoading?<div className="scope-list">
        {comparisons.map(({key,current,previous,currentContext,previousSituation})=>{
          const editing=canViewDetails&&editingKey===key&&editForm;
          return <article className="scope-inline-card runes-single-daily-stage" key={'compare-'+key}>
          <div className="home-rune-layout">
            <RuneCardInfo
              card={current}
              imageSrc={runeImage(current)}
              imageClassName={`loc-rune-card-image ${DIRECTION_ROTATION[current.direction]||'rune-rotate-0'}`}
              positionLabel={current.draw_kind==='supplement'?'補抽':'主抽'}
              direction={current.direction}
              realMoonPhase={currentContext?.moonPhase||'未知'}
              layout="home"
            />

            <div className="home-rune-copy home-rune-copy-plain">
              <p className="loc-eyebrow">{current.draw_kind==='supplement'?'每日補抽':'每日主抽'}{current.local_only?' · 本機紀錄':''}</p>
              <div className="daily-rune-heading-row">
                <h2>{current.rune_name} · {current.direction}</h2>
                {canViewDetails&&(!current.local_only||native)&&!editing?<div className="daily-rune-actions">
                  <button type="button" className="loc-button" disabled={saving} onClick={()=>beginEdit(current)}>編輯當日符文</button>
                  <button type="button" className="loc-button scope-danger-button" disabled={saving} onClick={()=>removeRecord(current)}>刪除當日符文</button>
                </div>:null}
              </div>
              <div className="home-draw-bubbles" aria-label="每日符文建議">
                <div className="loc-bubble">
                  <strong>當日狀況</strong>
                  <p>真實月相：{currentContext?.moonPhase||'未知'}。</p>
                  <p>{currentContext?.situation||'目前沒有對應的狀況形容。'}</p>
                </div>

                {currentContext?.reminder?<div className="loc-bubble">
                  <strong>每日占卜提醒</strong>
                  <p>{currentContext.reminder}</p>
                </div>:null}

                {currentContext?.guidance?<div className="loc-bubble">
                  <strong>每日占卜引導</strong>
                  <p>{currentContext.guidance}</p>
                </div>:null}

                {currentContext?.blessing?<div className="loc-bubble">
                  <strong>每日占卜祝福</strong>
                  <p>{currentContext.blessing}</p>
                </div>:null}

                <div className="loc-bubble">
                  <strong>前次紀錄</strong>
                  {previous?<>
                    <p>上次抽到「{current.rune_name}」是 {formatDate(previous.record_date)}，方向為 {previous.direction}，當日真實月相為 {previousSituation?.moonPhase||'未知'}。</p>
                    <p>之前的狀況：{previousSituation?.text||'目前沒有對應的狀況形容。'}</p>
                  </>:<p>此前沒有抽到「{current.rune_name}」的紀錄。</p>}
                </div>
              </div>
              {editing?<form className="scope-stat-controls" onSubmit={saveEdit}>
                <label><span>符文</span><select className="scope-select" value={editForm.runeNumber} onChange={event=>setEditForm(value=>({...value,runeNumber:event.target.value}))}>{runes.map(item=><option value={item.rune_id} key={item.rune_id}>{item.rune_id}｜{item.rune_name}</option>)}</select></label>
                <label><span>方向</span><select className="scope-select" value={editForm.direction} onChange={event=>setEditForm(value=>({...value,direction:event.target.value}))}>{DIRECTIONS.map(value=><option value={value} key={value}>{value}</option>)}</select></label>
                <button className="loc-button" type="submit" disabled={saving}>儲存</button>
                <button className="loc-button" type="button" disabled={saving} onClick={()=>{setEditingKey('');setEditForm(null)}}>取消</button>
              </form>:null}
            </div>
          </div>
        </article>;
        })}
      </div>:null}
    </section>:null}

    {canViewDetails?<DailyRuneTransfer cloudCanManage={canViewDetails&&!native}
      onImported={()=>{loadMonth();window.dispatchEvent(new CustomEvent('loc-rune-local-changed'));}}/>:null}
    {canWrite?<section className="loc-card">
      <p className="loc-eyebrow">手動紀錄</p>
      <h2>人工新增紀錄</h2>
      <form className="scope-stat-controls" onSubmit={addRecord}>
        <label><span>日期</span><input className="scope-select" type="date" min="2026-08-01" value={newForm.recordDate} onChange={event=>{
          const date=event.target.value;
          setNewForm(current=>({...current,recordDate:date}));
          if(/^\d{4}-\d{2}-\d{2}$/.test(date))setMonthValue(monthValueOf(date));
        }}/></label>
        <label><span>種類</span><select className="scope-select" value={newForm.drawKind} onChange={event=>setNewForm(current=>({...current,drawKind:event.target.value}))}><option value="main" disabled={selectedMonthReady&&occupiedSlots.main}>主抽{selectedMonthReady&&occupiedSlots.main?'（已有紀錄）':''}</option><option value="supplement" disabled={selectedMonthReady&&occupiedSlots.supplement}>補抽{selectedMonthReady&&occupiedSlots.supplement?'（已有紀錄）':''}</option></select></label>
        <label><span>符文</span><select className="scope-select" value={newForm.runeNumber} onChange={event=>setNewForm(current=>({...current,runeNumber:event.target.value}))}>{runes.map(row=><option value={row.rune_id} key={row.rune_id}>{row.rune_id}｜{row.rune_name}</option>)}</select></label>
        <label><span>方向</span><select className="scope-select" value={newForm.direction} onChange={event=>setNewForm(current=>({...current,direction:event.target.value}))}>{DIRECTIONS.map(value=><option value={value} key={value}>{value}</option>)}</select></label>
        <button className="loc-button" type="submit" disabled={saving||loading||!runes.length||dateIsFull||kindOccupied}>{saving?'儲存中…':'新增紀錄'}</button>
      </form>
      {dateIsFull?<p className="scope-status" role="status">這一天的主抽和補抽都已有紀錄，請選擇其他日期，或編輯既有紀錄。</p>:null}
      {selectedMonthReady&&!dateIsFull&&occupiedSlots.main?<p className="scope-status">這一天已有主抽，可新增補抽。</p>:null}
      {message?<p className="scope-status" role="status">{message}</p>:null}
    </section>:null}

    {canViewDetails&&error?<p role="alert" className="loc-status">{error}<button className="loc-button" type="button" onClick={loadMonth}>重新讀取</button></p>:null}
    {canViewDetails&&loading?<p className="loc-status" aria-live="polite">讀取每日符文紀錄…</p>:null}
    {canViewDetails&&!loading&&!error&&!rows.length?<article className="loc-card">目前沒有每日符文紀錄。</article>:null}
    {canViewDetails&&selectedDate&&!selectedRows.length?<article className="loc-card" aria-live="polite">這一天沒有每日符文紀錄。</article>:null}
  </Root>;
}
