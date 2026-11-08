'use client';

import {FeaturePage} from '../../modular/ui';
import {Capacitor} from '@capacitor/core';
import {useEffect,useState} from 'react';
import dynamic from 'next/dynamic';
import PanelLoading from '../PanelLoading';

const PrivateLocalFiles=dynamic(()=>import('../PrivateLocalFiles'),{loading:PanelLoading});

export default function LocalSettingView(){
  const [native,setNative]=useState(false);
  useEffect(()=>setNative(Capacitor.isNativePlatform()&&Capacitor.getPlatform()==='ios'),[]);
  return <FeaturePage featureId="manage">
    {native?<PrivateLocalFiles/>:
      <section className="loc-card"><p>本機管理僅在 iOS App 提供。</p></section>}
  </FeaturePage>;
}
