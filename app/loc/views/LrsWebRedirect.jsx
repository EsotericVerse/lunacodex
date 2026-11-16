'use client';
import {useEffect} from 'react';
const ORIGIN='https://lrs.lo3rwang.cc';
export default function LrsWebRedirect({path='/'}){
 const suffix='/'+String(path||'/').split('/').filter(Boolean).join('/')+'/';
 const target=ORIGIN+(suffix==='//'?'/' : suffix.slice(1));
 useEffect(()=>{window.location.replace(target);},[target]);
 return <main className="loc-next-main"><section className="loc-view" aria-label="月之符文">
  <p>正在前往 LunaRunes…</p><a href={target} className="loc-button">進入月之符文</a>
 </section></main>;
}
