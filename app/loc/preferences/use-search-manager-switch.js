'use client';

import {useCallback,useEffect,useState} from 'react';

// Visual session-only choice. This key never carries a role, grant, token
// or database preference; server-side permissions are unaffected.
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
  window.dispatchEvent(new CustomEvent(EVENT,{detail:{value:false}}));
}
export function useSearchManagerSwitch(){
  const [enabled,setEnabled]=useState(false);
  useEffect(()=>{
    const saved=readChoice();
    if(saved!==null)setEnabled(saved);
    const update=event=>setEnabled(Boolean(event.detail?.value));
    window.addEventListener(EVENT,update);
    return()=>window.removeEventListener(EVENT,update);
  },[]);
  const set=useCallback(value=>{
    const next=Boolean(value);
    setEnabled(next);
    try{window.sessionStorage.setItem(KEY,next?'1':'0');}catch{}
    window.dispatchEvent(new CustomEvent(EVENT,{detail:{value:next}}));
  },[]);
  return {enabled,setEnabled:set};
}
