'use client';
import {useEffect,useState,useSyncExternalStore} from 'react';
import {Capacitor} from '@capacitor/core';
import {openLocalGalaxy} from './local-scope-galaxy.mjs';
import {
  LOCAL_SCOPE_MINUTES,getLocalDeadline,subscribeLocalDeadline,
  startLocalDeadline,stopLocalDeadline,formatLocalCountdown
} from './local-scope-session.mjs';

export default function LocalScopeModeSettings(){
  const deadline=useSyncExternalStore(subscribeLocalDeadline,getLocalDeadline,()=>0);
  const [now,setNow]=useState(0);
  const [minutes,setMinutes]=useState(30);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [native,setNative]=useState(false);
  useEffect(()=>setNative(Capacitor.isNativePlatform()&&Capacitor.getPlatform()==='ios'),[]);
  useEffect(()=>{
    if(!deadline)return;
    const tick=()=>{
      const current=Date.now();
      setNow(current);
      if(current>=deadline)stopLocalDeadline();
    };
    tick();
    const interval=setInterval(tick,1000);
    return()=>clearInterval(interval);
  },[deadline]);
  const remaining=deadline?formatLocalCountdown(deadline,now||Date.now()):'';
  async function enable(){
    if(busy||!native)return;
    setBusy(true);setError('');
    try{
      // A mode that cannot open its local core MUST NOT turn on.
      const db=await openLocalGalaxy();
      db.close();
      startLocalDeadline(minutes);
      window.location.assign('/local/index.html');
    }catch(error){setError(String(error?.message||error))}
    finally{setBusy(false)}
  }
  function disable(){
    if(busy)return;
    stopLocalDeadline();
    window.location.assign('/?loc_direct=1');
  }
  return <section className="loc-card loc-local-session-card" aria-labelledby="loc-local-session-title">
    <p className="loc-eyebrow">LOCAL DATABASE CORE</p>
    <h2 id="loc-local-session-title">限時使用本機資料庫</h2>
    <p className="scope-settings-note">
      啟用後，網站原本的首頁、文化、統計、痕跡、搜尋、設定六鍵將暫時使用這台 iPhone 的本機 Galaxy。
      原始資料不會自動上傳至雲端；到期或手動關閉後，恢復網站資料來源。
    </p>
    {deadline?<div className="loc-local-lease-clock" role="status">
      <strong>本機資料庫模式啟用中</strong><output aria-label="剩餘時間">{remaining}</output>
    </div>:<div className="scope-stat-controls">
      <label htmlFor="loc-local-lease-minutes">啟用時間</label>
      <select id="loc-local-lease-minutes" className="scope-select"
        value={minutes} disabled={busy||!native}
        onChange={event=>setMinutes(Number(event.target.value))}>
        {LOCAL_SCOPE_MINUTES.map(value=><option value={value} key={value}>{value} 分鐘</option>)}
      </select>
    </div>}
    <div className="scope-stat-controls">
      {deadline?<button type="button" className="loc-button" onClick={disable} disabled={busy}>
        立即關閉並返回網站
      </button>:<button type="button" className="loc-button primary"
        disabled={!native||busy} onClick={enable}>
        {busy?'正在確認資料庫…':'開啟限時本機模式'}
      </button>}
    </div>
    {!native?<p className="scope-settings-note">本機資料庫切換僅在 iOS App 提供。</p>:null}
    {error?<p role="alert" className="scope-status scope-error">{error}</p>:null}
  </section>;
}
