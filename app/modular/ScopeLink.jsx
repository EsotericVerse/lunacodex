'use client';

import Link from 'next/link';

export function isSameOriginHref(href=''){
  const value=String(href||'');
  if(!/^https?:\/\//i.test(value))return true;
  if(typeof window==='undefined')return false;
  try{
    return new URL(value,window.location.href).origin===window.location.origin;
  }catch{return false;}
}

// Management pages have independent static HTML entrypoints, so they retain
// full-document navigation; the browser retires the previous document itself.
export function isManagementHref(href=''){
  try{return /(?:^|\/)manage(?:\/|$)/i.test(
    new URL(String(href),'https://loc.example').pathname);}
  catch{return false;}
}

// SPA cleanup belongs to PageResourceBoundary, once per actual route change.
// Clicking a link must not reset readers ahead of that new route's first paint.
// The shared NAV is visible on every page. Next's default viewport prefetch
// otherwise fetches every route's HTML and RSC payload before a user clicks.
export default function ScopeLink({href,native=false,children,onClick,target,prefetch=false,...rest}){
  if(native||!isSameOriginHref(href)||isManagementHref(href))
    return <a href={href} target={target} onClick={onClick} {...rest}>{children}</a>;
  return <Link href={href} target={target} onClick={onClick} prefetch={prefetch} {...rest}>{children}</Link>;
}
