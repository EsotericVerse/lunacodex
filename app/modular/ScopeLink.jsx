'use client';

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

// Every LOC route is a real exported HTML document. Use native anchors.
export default function ScopeLink({href,children,onClick,target,native=false,...rest}){
  return <a href={href} target={target} onClick={onClick} {...rest}>{children}</a>;
}
