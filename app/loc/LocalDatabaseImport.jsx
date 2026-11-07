'use client';

import {useEffect,useState} from 'react';
import dynamic from 'next/dynamic';
import {Capacitor} from '@capacitor/core';
import PanelLoading from './PanelLoading';

// Reuse the existing format analysis and UID-deduplicated batch importer.
// Never use the cloud management path for the private 'local' Scope.
const ManagementImportPanel=dynamic(()=>import('./ManagementImportPanel'),{loading:PanelLoading});

export default function LocalDatabaseImport(){
  const [native,setNative]=useState(false);
  useEffect(()=>setNative(Capacitor.isNativePlatform()&&Capacitor.getPlatform()==='ios'),[]);
  if(!native)return null;
  return <section className="loc-card scope-feature-card">
    <h2>文件匯入</h2>
    <p className="scope-status">選擇檔案後先解析並預覽，確認「開始匯入」才寫入本機 SQLite（local）；不寫入遠端 SQL 資料庫。</p>
    <ManagementImportPanel scopeId="local"/>
  </section>;
}
