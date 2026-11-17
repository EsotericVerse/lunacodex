'use client';

import {useCallback,useEffect,useRef,useState} from 'react';

// A visual preference only. This key never carries a role, grant or token;
// server-side article and editor permissions are unaffected.
const KEY='loc-search-manager-toggle-v1';
const EVENT='loc-search-manager-toggle-changed';
function readChoice(){
  if(typeof window==='undefined')return null;
  try{
    const saved=window.sessionStorage.getItem(KEY);
    return saved==='1'?true:saved==='0'?false:null;
  }catch{return null;}
}
export function clearSearchManagerSwitch(){
  if(typeof window==='undefined')return;
  try{window.sessionStorage.removeItem(KEY);}catch{}
  window.dispatchEvent(new CustomEvent(EVENT,{detail:{value:false,explicit:false}}));
}
export function useSearchManagerSwitch({defaultValue=false,preferenceReady=false}={}){
  const [enabled,setEnabled]=useState(false);
  const [explicit,setExplicit]=useState(false);
  const chosen=useRef(false);
  useEffect(()=>{
    const saved=readChoice();
    if(saved!==null){chosen.current=true;setExplicit(true);setEnabled(saved);}
    const update=event=>{
      const value=Boolean(event.detail?.value);
      chosen.current=Boolean(event.detail?.explicit);
      setExplicit(chosen.current);setEnabled(value);
    };
    window.addEventListener(EVENT,update);
    return()=>window.removeEventListener(EVENT,update);
  },[]);
  useEffect(()=>{
    if(preferenceReady&&!chosen.current)setEnabled(Boolean(defaultValue));
  },[preferenceReady,defaultValue]);
  const set=useCallback(value=>{
    const next=Boolean(value);
    chosen.current=true;
    setExplicit(true);setEnabled(next);
    try{window.sessionStorage.setItem(KEY,next?'1':'0');}catch{}
    window.dispatchEvent(new CustomEvent(EVENT,{detail:{value:next,explicit:true}}));
  },[]);
  return {enabled,explicit,setEnabled:set};
}
