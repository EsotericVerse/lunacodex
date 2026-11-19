'use client';
import {useEffect} from 'react';
import {locServiceHref} from '../../modular/routing/service-route-index.mjs';
export default function LrsWebRedirect({path='/'}){
 const suffix=String(path||'/').split('/').filter(Boolean).join('/');
 const target=locServiceHref('lrs','/'+(suffix?suffix+'/':''));
 useEffect(()=>{window.location.replace(target);},[target]);
 return <main className="loc-next-main"><section className="loc-view" aria-label="月之符文">
  <p>正在前往 LunaRunes…</p><a href={target} className="loc-button">進入月之符文</a>
 </section></main>;
}
