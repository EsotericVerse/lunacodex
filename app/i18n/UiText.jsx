'use client';

import {useUiLocale} from './ui-locale';

// Copy is available from the selected page+locale, not from a zh_tw fallback.
function atPath(source,path){
  return String(path||'').split('.').reduce((value,key)=>value?.[key],source);
}
export function localizedUiText(copy,id,params={}){
  const resolved=atPath(copy,id);
  const text=typeof resolved==='string'?resolved:id;
  return text.replace(/\{([a-zA-Z][\w]*)\}/gu,(match,key)=>
    Object.prototype.hasOwnProperty.call(params,key)?String(params[key]??''):match);
}
export function useUiText(){
  const {copy}=useUiLocale();
  return (id,params)=>localizedUiText(copy,id,params);
}
export default function UiText({id,params}){
  const t=useUiText();
  return t(id,params);
}
