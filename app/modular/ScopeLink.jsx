'use client';

// Management uses the same browser-native document navigation as public LOC pages.
export function isManagementHref(href=''){
  try{return /(?:^|\/)manage(?:\/|$)/i.test(
    new URL(String(href),'https://loc.example').pathname);}
  catch{return false;}
}

// Every LOC route is a real exported HTML document. Use native anchors.
export default function ScopeLink({href,children,onClick,target,native=false,...rest}){
  return <a href={href} target={target} onClick={onClick} {...rest}>{children}</a>;
}
