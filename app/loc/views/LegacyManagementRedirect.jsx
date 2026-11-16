'use client';
import {useEffect} from 'react';
import {Capacitor} from '@capacitor/core';
import LocApp from '../LocApp';

export default function LegacyManagementRedirect({target,view,scope=null}){
  const native=Capacitor.isNativePlatform();
  useEffect(()=>{
    if(native)return;
    const next=new URL(target,window.location.origin);
    const old=new URL(window.location.href);
    for(const [key,value] of old.searchParams)
      if(!next.searchParams.has(key))next.searchParams.append(key,value);
    next.hash=old.hash;
    window.location.replace(next.href);
  },[target,native]);
  // Keep the existing iOS bundled entrypoint working without a file:// redirect.
  return native?<LocApp forcedView={view} forcedScope={scope}/>:
    <p className="scope-status" role="status">正在開啟管理入口…</p>;
}
