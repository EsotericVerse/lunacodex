'use client';

import {useEffect,useState} from 'react';
import {FLASH_EVENT} from './flash-message';

export default function FlashMessage(){
  const [text,setText]=useState('');
  useEffect(()=>{
    let timer=0;
    const show=event=>{
      setText(event.detail);
      window.clearTimeout(timer);
      timer=window.setTimeout(()=>setText(''),3000);
    };
    window.addEventListener(FLASH_EVENT,show);
    return()=>{window.removeEventListener(FLASH_EVENT,show);window.clearTimeout(timer);};
  },[]);
  if(!text)return null;
  return <div role="status" aria-live="polite" style={{position:'fixed',left:'50%',bottom:'16px',transform:'translateX(-50%)',background:'rgba(0,0,0,0.8)',color:'#fff',padding:'8px 14px',borderRadius:'6px',zIndex:9999,fontSize:'14px',pointerEvents:'none'}}>{text}</div>;
}
