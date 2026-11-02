'use client';
import {useEffect} from 'react';
import {Capacitor} from '@capacitor/core';
import {useAccount} from './use-account';
import {useEditDock} from '../modular/edit-dock';
import {readHomeEditorAccess,clearHomeEditorAccess} from './home-edit-access.mjs';
export default function HomeEditModeRestore({scopeId}){
  const account=useAccount({enabled:false});
  const dock=useEditDock();
  useEffect(()=>{
    if(dock?.active)return undefined;
    const marker=readHomeEditorAccess(window.sessionStorage);
    if(!marker||marker.scopeId!==scopeId){
      if(!marker)clearHomeEditorAccess(window.sessionStorage);
      return undefined;
    }
    if(scopeId==='local'&&marker.userId==='local-device'&&Capacitor.isNativePlatform()){
      dock?.begin('local');return undefined;
    }
    let active=true;
    // Reuse verified in-memory Scope grants when returning within the same
    // document. A full page load has no cache and still verifies remotely.
    void account.refresh().then(result=>{
      if(!active)return;
      const allowed=marker.userId===result?.user?.id&&(
        scopeId==='loc'?result.authorizer?.canManageGroupSync('loc'):
          result.authorizer?.canManageScopeSync(scopeId));
      if(!allowed){clearHomeEditorAccess(window.sessionStorage);return;}
      if(readHomeEditorAccess(window.sessionStorage))dock?.begin(scopeId);
    }).catch(()=>{if(active)clearHomeEditorAccess(window.sessionStorage);});
    return ()=>{active=false;};
  },[scopeId,dock?.active,dock?.begin,account.refresh]);
  return null;
}
