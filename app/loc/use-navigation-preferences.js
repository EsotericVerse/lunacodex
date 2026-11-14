'use client';

import {useEffect,useState} from 'react';
import {usePassiveSessionAccount} from './use-account';
import {getSettings} from './user-storage';
import {NavigationPreferences} from '../modular/navigation-preferences';
const accountNavigation=NavigationPreferences.account;


const INITIAL={home:'loc',favorites:[...accountNavigation.DEFAULT_FAVORITES],folders:[],loading:true,error:''};
export function useNavigationPreferences({enabled=true}={}){
  const account=usePassiveSessionAccount();
  const [preferences,setPreferences]=useState(INITIAL);
  const identity=account.user?.id||account.user?.email||'';
  useEffect(()=>{
    if(!enabled){setPreferences({...INITIAL,loading:false});return;}
    if(account.loading||account.permissionLoading)return;
    if(!identity){setPreferences({...INITIAL,loading:false});return;}
    let live=true;
    setPreferences(current=>({...current,loading:true,error:''}));
    const keys=[accountNavigation.HOME_SETTING_KEY,accountNavigation.FAVORITES_SETTING_KEY,accountNavigation.folders.FOLDERS_SETTING_KEY];
    getSettings(keys,identity).then(settings=>{if(live)setPreferences({
        home:accountNavigation.validScopeId(settings[keys[0]])||'loc',
        favorites:accountNavigation.parseFavorites(settings[keys[1]]),
        folders:accountNavigation.folders.parseFavoriteFolders(settings[keys[2]]),
        loading:false,error:''
      });})
      .catch(error=>{if(live)setPreferences({...INITIAL,loading:false,error:String(error?.message||error)});});
    return()=>{live=false;};
  },[enabled,identity,account.loading,account.permissionLoading]);
  useEffect(()=>{
    const update=event=>setPreferences(current=>({
      ...current,...event.detail,
      favorites:Object.hasOwn(event.detail||{},'favorites')?accountNavigation.parseFavorites(event.detail.favorites):current.favorites,
      folders:Object.hasOwn(event.detail||{},'folders')?accountNavigation.folders.parseFavoriteFolders(event.detail.folders):current.folders
    }));
    window.addEventListener('loc-navigation-changed',update);
    return()=>window.removeEventListener('loc-navigation-changed',update);
  },[]);
  return {...preferences,account};
}
