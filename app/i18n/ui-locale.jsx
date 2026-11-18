'use client';

import {createContext,useContext,useEffect,useMemo,useState} from 'react';
import {featureSection,isUiLocaleLoaded,loadUiLocale,normalizeUiLocale,
  subscribeSectionVersion,uiCopy,UI_LOCALE} from './ui-copy';

const UiLocaleContext=createContext(Object.freeze({
  locale:UI_LOCALE,
  copy:uiCopy(UI_LOCALE)
}));

// The client pathname resolves to the directory containing page.jsx.
// Wait for the Scope's real locale before any request (no zh_tw prefetch).
export function useLoadedUiLocale(locale,pathname='/',enabled=true){
  const language=normalizeUiLocale(locale);
  const [,refresh]=useState(0);
  useEffect(()=>{
    if(!enabled)return undefined;
    let active=true;
    loadUiLocale(language,pathname)
      .then(()=>{if(active)refresh(value=>value+1);})
      .catch(()=>{if(active)refresh(value=>value+1);});
    return ()=>{active=false;};
  },[language,pathname,enabled]);
  return Boolean(enabled)&&isUiLocaleLoaded(language,pathname);
}
function useSectionTick(){
  const [tick,setTick]=useState(0);
  useEffect(()=>subscribeSectionVersion(()=>setTick(value=>value+1)),[]);
  return tick;
}
export function UiLocaleProvider({locale=UI_LOCALE,pathname='/',children}){
  const language=normalizeUiLocale(locale);
  const ready=useLoadedUiLocale(language,pathname);
  const tick=useSectionTick();
  const copy=useMemo(()=>uiCopy(language,pathname),[language,pathname,ready,tick]);
  return <UiLocaleContext.Provider value={{locale:language,copy}}>
    {ready?children:<div className="loc-loading" role="status">Loading interface…</div>}
  </UiLocaleContext.Provider>;
}
export function useUiLocale(){return useContext(UiLocaleContext);}
export function useUiCopy(){return useUiLocale().copy;}
export function useFeatureCopy(section,defaults={}){
  const {locale,copy}=useUiLocale();
  return copy.featureCopy?.[section]||featureSection(locale,section,defaults);
}
// The page owns the selected locale dictionary; individual sections no longer
// fetch or register anything. Existing call sites remain source compatible.
export function useUiSection(_path){}
