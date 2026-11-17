'use client';

import {useEffect,useRef} from 'react';

const FOCUSABLE='a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

// Shared by the illustrated atlas, daily reading and draw results.
// Every modal keeps keyboard input inside itself and restores the caller.
export default function useRuneDialogFocus(onClose,enabled=true){
  const dialogRef=useRef(null);
  const closeRef=useRef(onClose);
  closeRef.current=onClose;
  useEffect(()=>{
    if(!enabled||typeof document==='undefined')return undefined;
    const dialog=dialogRef.current;
    if(!dialog)return undefined;
    const previousFocus=document.activeElement;
    const previousOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    (dialog.querySelector(FOCUSABLE)||dialog).focus({preventScroll:true});
    const handleKey=event=>{
      if(event.key==='Escape'){
        event.preventDefault();
        closeRef.current?.();
        return;
      }
      if(event.key!=='Tab')return;
      const targets=Array.from(dialog.querySelectorAll(FOCUSABLE))
        .filter(element=>element.getClientRects().length>0);
      if(!targets.length){
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first=targets[0],last=targets[targets.length-1];
      if(event.shiftKey&&(document.activeElement===first||!dialog.contains(document.activeElement))){
        event.preventDefault();
        last.focus();
      }else if(!event.shiftKey&&(document.activeElement===last||!dialog.contains(document.activeElement))){
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown',handleKey);
    return()=>{
      document.removeEventListener('keydown',handleKey);
      document.body.style.overflow=previousOverflow;
      if(previousFocus instanceof HTMLElement&&previousFocus.isConnected){
        previousFocus.focus({preventScroll:true});
      }
    };
  },[enabled]);
  return dialogRef;
}
