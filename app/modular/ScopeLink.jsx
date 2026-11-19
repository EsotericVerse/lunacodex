'use client';

import Link from 'next/link';

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

// Route cleanup belongs to PageResourceBoundary, once per actual SPA route
// change. A full-document navigation releases its own browser resources.
// Clicking a link must never clear the new route's resource generation twice.
export default function ScopeLink({href,native=false,children,onClick,target,...rest}){
  if(native||!isSameOriginHref(href)||isManagementHref(href))
    return <a href={href} target={target} onClick={onClick} {...rest}>{children}</a>;
  return <Link href={href} target={target} onClick={onClick} {...rest}>{children}</Link>;
}
