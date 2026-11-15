'use client';

// Short, non-blocking notice for failed reads. Throttled to prevent repeated notices.
export const FLASH_EVENT='loc-flash-message';
const THROTTLE_MS=3000;
let lastAt=0;
export function flashMessage(text){
  if(typeof window==='undefined')return;
  const now=Date.now();
  if(now-lastAt<THROTTLE_MS)return;
  lastAt=now;
  window.dispatchEvent(new CustomEvent(FLASH_EVENT,{detail:String(text||'')}));
}
