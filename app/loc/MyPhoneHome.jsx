'use client';
import FieldText from '../i18n/FieldText';

import {useEffect,useState} from 'react';
import {Capacitor} from '@capacitor/core';
import PrivateLocalFiles from './PrivateLocalFiles';

export default function MyPhoneHome(){
  const [native,setNative]=useState(false);
  useEffect(()=>{
    setNative(Capacitor.isNativePlatform()&&Capacitor.getPlatform()==='ios');
  },[]);

  return <main className="scope-main"><section className="scope-page">
    <header className="loc-hero"><p className="loc-eyebrow"><FieldText text="我的資料"/></p><h1><FieldText text="使用說明"/></h1></header>
    {native?<div className="scope-content">
      <section className="loc-card">
        <p className="scope-status">本機資料庫尚未啟用</p>
        <p>Local Scope 尚未設定資料庫引擎。下方私人檔案庫可單獨保存原始檔案，不會自動寫入 Galaxy。</p>
      </section>
      <PrivateLocalFiles/>
    </div>:
      <section className="loc-card"><p>僅在 iOS App 提供。</p></section>}
  </section></main>;
}
