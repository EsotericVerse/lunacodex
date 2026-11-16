'use client';
import {useEffect} from 'react';
const target='https://lrs.lo3rwang.cc/';
export default function LrsPortalView(){
  useEffect(()=>{window.location.replace(target);},[]);
  return <main className="loc-next-main"><section className="loc-view" aria-label="月之符文">
    <p>正在前往月之符文…</p>
    <a className="loc-button" href={target}>進入 LunaRunes</a>
  </section></main>;
}
