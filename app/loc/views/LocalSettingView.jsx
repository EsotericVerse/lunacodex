'use client';
import {useEffect,useState} from 'react';
import {Capacitor} from '@capacitor/core';
import {FeaturePage} from '../../modular/ui';
import LocalScopeModeSettings from '../LocalScopeModeSettings';
import PrivateLocalFiles from '../PrivateLocalFiles';
export default function LocalSettingView(){
  const [native,setNative]=useState(false);
  useEffect(()=>setNative(Capacitor.isNativePlatform()&&Capacitor.getPlatform()==='ios'),[]);
  return <FeaturePage featureId="manage">
    {native?<div className="loc-local-settings">
      <LocalScopeModeSettings/>
      <details className="loc-card">
        <summary>原始檔案庫（選用）</summary>
        <PrivateLocalFiles/>
      </details>
    </div>:<section className="loc-card"><p>本機設定僅在 iOS App 提供。</p></section>}
  </FeaturePage>;
}
