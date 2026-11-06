'use client';
import {useEffect} from 'react';
import {Capacitor} from '@capacitor/core';
import {useEditDock} from '../modular/edit-dock';
import {readHomeEditorAccess,clearHomeEditorAccess} from './home-edit-access.mjs';
// Single unified permission entry point: ScopeHomeEditEntry.jsx is the only
// place that performs a live account check (the api.manage RPC) to
// grant edit mode, and it writes HOME_EDIT_ENTRY_KEY with its own TTL
// (edit-session-ttl.mjs: 30-minute idle / 2-hour absolute). This component
// restores that already-granted state across the full page reloads a static
// export does on every navigation; it used to ALSO re-run that live account
// check here on every single mount, which is what made entering edit mode
// trigger a fresh `manage()` DB query on every page within the same editing
// session. The TTL marker is the trust window now; the next DB-authoritative
// checks are the explicit re-entry click and every write's own server-side
// RLS (preflightWrite -> assertAuthorizationForTable), not this restore path.
export default function HomeEditModeRestore({scopeId}){
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
    dock?.begin(scopeId);
    return undefined;
  },[scopeId,dock?.active,dock?.begin]);
  return null;
}
