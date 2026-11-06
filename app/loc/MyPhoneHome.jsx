'use client';
import FieldText from '../i18n/FieldText';

import {useEffect,useState} from 'react';
import {Capacitor} from '@capacitor/core';
import PrivateLocalFiles from './PrivateLocalFiles';
import ScopeLink from '../modular/ScopeLink';
import {navigationHref} from '../modular/scope-registry';

export default function MyPhoneHome(){
  const [native,setNative]=useState(false);
  useEffect(()=>{
    setNative(Capacitor.isNativePlatform()&&Capacitor.getPlatform()==='ios');
  },[]);

  return <main className="scope-main"><section className="scope-page">
    <header className="loc-hero"><p className="loc-eyebrow"><FieldText text="我的資料"/></p><h1><FieldText text="使用說明"/></h1></header>
    {native?<div className="scope-content">
      <section className="loc-card">
        <p className="scope-status">本機資料空間 · SQLite（local）</p>
        <p>使用「設定 → 文件匯入」可解析並確認寫入本機 SQLite；下方原始檔案庫只保存檔案，不會自動變成 Galaxy 文章。</p>
        <div className="scope-result-links">
          {[
            {id:'culture',label:'文化'},
            {id:'statics',label:'統計'},
            {id:'search',label:'搜尋'},
            {id:'manage',label:'管理'}
          ].map(item=><ScopeLink key={item.id} native href={navigationHref('local',item.id,true)}>{item.label}</ScopeLink>)}
        </div>
        <p><ScopeLink native href={navigationHref('local','',true)}>前往本機資料頁（可開啟編輯模式）</ScopeLink></p>
      </section>
      <PrivateLocalFiles/>
    </div>:
      <section className="loc-card"><p>僅在 iOS App 提供。</p></section>}
  </section></main>;
}
