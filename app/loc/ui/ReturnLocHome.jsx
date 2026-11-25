'use client';
import {useEffect,useState} from 'react';
import {Capacitor} from '@capacitor/core';

const HOME='https://loc.lo3rwang.cc/';
const DELAY=3000;

export default function ReturnLocHome({reason='route'}){
  const [href,setHref]=useState(HOME);
  useEffect(()=>{
    const native=Capacitor.isNativePlatform()||window.location.protocol==='capacitor:';
    const target=native?'/index.html?loc_direct=1':HOME;
    setHref(target);
    const current=new URL(window.location.href),home=new URL(target,current);
    if(current.origin===home.origin&&current.pathname===home.pathname)return;
    const timer=window.setTimeout(()=>window.location.replace(target),DELAY);
    return()=>window.clearTimeout(timer);
  },[]);
  return <main className="loc-next-main">
    <section className="loc-view">
      <header className="loc-hero" role="status">
        <p className="loc-eyebrow">LOC · 月典</p>
        <h1>此頁面目前無法使用</h1>
        <p>{reason==='feature'?'此功能尚未開放，或頁面已變更。':'網址可能已變更，或此頁面尚未發布。'}</p>
        <p>將於 3 秒後返回月典首頁。</p>
        <a className="loc-button primary" href={href}>立即返回首頁</a>
      </header>
    </section>
  </main>;
}
