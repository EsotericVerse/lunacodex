'use client';

import {useEffect,useState} from 'react';
import {usePassiveSessionAccount} from './use-account';
import {getSettings} from './user-storage';
import {NavigationPreferences} from '../modular/navigation-preferences';
const accountNavigation=NavigationPreferences.account;


const INITIAL={home:'loc',loading:true,error:''};
export function useNavigationPreferences(){
  const account=usePassiveSessionAccount();
  const [preferences,setPreferences]=useState(INITIAL);
  const identity=account.user?.id||account.user?.email||'';
  useEffect(()=>{
    if(account.loading||account.permissionLoading)return;
    if(!identity){setPreferences({...INITIAL,loading:false});return;}
    let live=true;
    setPreferences(current=>({...current,loading:true,error:''}));
    // Favorites/folders are retired; read only the saved homepage scalar.
    const keys=[accountNavigation.HOME_SETTING_KEY];
    getSettings(keys,identity).then(settings=>{if(live)setPreferences({
        home:accountNavigation.validScopeId(settings[keys[0]])||'loc',
        loading:false,error:''
      });})
      .catch(error=>{if(live)setPreferences({...INITIAL,loading:false,error:String(error?.message||error)});});
    return()=>{live=false;};
  },[identity,account.loading,account.permissionLoading]);
  useEffect(()=>{
    const update=event=>setPreferences(current=>({
      ...current,home:Object.hasOwn(event.detail||{},'home')
        ?accountNavigation.validScopeId(event.detail.home)||'loc':current.home
    }));
    window.addEventListener('loc-navigation-changed',update);
    return()=>window.removeEventListener('loc-navigation-changed',update);
  },[]);
  return {...preferences,account};
}
