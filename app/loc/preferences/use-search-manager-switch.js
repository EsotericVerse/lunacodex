'use client';

import {useCallback,useEffect,useState} from 'react';

// The switch is shared within the current document and never persisted.
const EVENT='loc-search-manager-toggle-changed';
let currentChoice=false;
export function clearSearchManagerSwitch(){
  currentChoice=false;
  if(typeof window!=='undefined')
    window.dispatchEvent(new CustomEvent(EVENT,{detail:{value:false}}));
}
export function useSearchManagerSwitch(){
  const [enabled,setEnabled]=useState(()=>currentChoice);
  useEffect(()=>{
    const update=event=>setEnabled(Boolean(event.detail?.value));
    window.addEventListener(EVENT,update);
    return()=>window.removeEventListener(EVENT,update);
  },[]);
  const set=useCallback(value=>{
    const next=Boolean(value);
    setEnabled(next);
    currentChoice=next;
    window.dispatchEvent(new CustomEvent(EVENT,{detail:{value:next}}));
  },[]);
  return {enabled,setEnabled:set};
}
