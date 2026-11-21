import {useMemo,useSyncExternalStore} from 'react';
const sub=fn=>{
  if(typeof window==='undefined')return ()=>{};
  window.addEventListener('popstate',fn);
  return ()=>window.removeEventListener('popstate',fn);
};
export const usePathname=()=>useSyncExternalStore(sub,()=>location.pathname,()=>'/');
export const useSearchParams=()=>{
  const q=useSyncExternalStore(sub,()=>location.search,()=>'');
  return useMemo(()=>new URLSearchParams(q),[q]);
};
function toUrl(value){
  if(typeof value==='string')return value;
  if(!value||typeof value!=='object')return '/';
  const path=value.pathname||'/';
  const params=new URLSearchParams(value.query||{});
  return path+(params.size?'?'+params.toString():'')+(value.hash||'');
}
const router=Object.freeze({
  push:value=>window.location.assign(toUrl(value)),
  replace:value=>window.location.replace(toUrl(value)),
  back:()=>window.history.back(),
  forward:()=>window.history.forward(),
  refresh:()=>window.location.reload(),
  prefetch:()=>Promise.resolve()
});
export function useRouter(){return router;}
