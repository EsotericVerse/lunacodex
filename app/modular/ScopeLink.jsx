'use client';

import Link from 'next/link';
import {prepareTransientResourceAction} from '../../zenstack/client-queries';

export function isSameOriginHref(href=''){
  const value=String(href||'');
  if(!/^https?:\/\//i.test(value))return true;
  if(typeof window==='undefined')return false;
  try{
    return new URL(value,window.location.href).origin===window.location.origin;
  }catch{
    return false;
  }
}

// Static management exports have real HTML entrypoints. A full navigation
// avoids fetching an RSC/chunk from a previous deployment's App Router.
export function isManagementHref(href=''){
  try{return /(?:^|\/)manage(?:\/|$)/i.test(new URL(String(href),'https://loc.example').pathname);}
  catch{return false;}
}

function entersHeavyRuneRoute(pathname){
  const clean=String(pathname||'').replace(/\/index\.html$/i,'').replace(/\/+$/,'');
  return /^(?:\/lrunes)?\/(?:card\/(?:duel|list|daily)|game)$/i.test(clean);
}
// A single click boundary covers ALL ordinary LOC feature links, including
// non-dock navigation. Heavy Rune/game entrypoints have a pre-mount gate of
// their own so they reset the read spool exactly once, after route entry.
export default function ScopeLink({href,native=false,children,onClick,target,...rest}){
  const beforeNavigate=event=>{
    onClick?.(event);
    if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||
      event.shiftKey||event.altKey||(target&&target!=='_self')||
      typeof window==='undefined')return;
    let to;
    try{to=new URL(String(href),window.location.href);}catch{return;}
    const from=new URL(window.location.href);
    if(to.origin!==from.origin||
      (to.pathname===from.pathname&&to.search===from.search))return;
    if(!entersHeavyRuneRoute(to.pathname))
      prepareTransientResourceAction('navigation');
  };
  if(native||!isSameOriginHref(href)||isManagementHref(href))
    return <a href={href} target={target} onClick={beforeNavigate} {...rest}>{children}</a>;
  return <Link href={href} target={target} onClick={beforeNavigate} {...rest}>{children}</Link>;
}
