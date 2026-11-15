'use client';
import {useSyncExternalStore} from 'react';
import {DEFAULT_TIME_UNIT_CHANGED,readDefaultTimeUnit} from './default-time-unit.mjs';
const subscribe=callback=>{
  window.addEventListener(DEFAULT_TIME_UNIT_CHANGED,callback);
  window.addEventListener('storage',callback);
  return ()=>{
    window.removeEventListener(DEFAULT_TIME_UNIT_CHANGED,callback);
    window.removeEventListener('storage',callback);
  };
};
export default function useDefaultTimeUnit(){
  return useSyncExternalStore(subscribe,readDefaultTimeUnit,()=>'auto');
}
