const PREFIX='loc:trace:default-route:';
export const TRACE_DEFAULT_ROUTE_CHANGED='loc:trace:default-route-changed';
const validScope=value=>/^[a-z][a-z0-9]{0,14}$/.test(String(value||''));
const validUid=value=>/^(?:[A-Za-z0-9]{4}|[A-Za-z0-9]{8})$/.test(String(value||''));
export function readDefaultTraceRoute(scope){
  if(!validScope(scope)||typeof window==='undefined')return '';
  try{const uid=window.localStorage.getItem(PREFIX+scope)||'';return validUid(uid)?uid:'';}
  catch{return '';}
}
export function setDefaultTraceRoute(scope,uid){
  if(!validScope(scope)||!validUid(uid)||typeof window==='undefined')return false;
  try{window.localStorage.setItem(PREFIX+scope,uid);
    window.dispatchEvent(new Event(TRACE_DEFAULT_ROUTE_CHANGED));return true;}
  catch{return false;}
}
export function clearDefaultTraceRoute(scope,uid=''){
  if(!validScope(scope)||typeof window==='undefined')return false;
  try{if(uid&&readDefaultTraceRoute(scope)!==uid)return false;
    window.localStorage.removeItem(PREFIX+scope);
    window.dispatchEvent(new Event(TRACE_DEFAULT_ROUTE_CHANGED));return true;}
  catch{return false;}
}
export function chooseDefaultTraceRoute(rows,scope,preferredUid=''){
  const matches=(Array.isArray(rows)?rows:[]).filter(row=>
    ['path','trace'].includes(row?.trace_type)
    &&row.source_scope===scope&&validUid(row.uid));
  return matches.find(row=>row.uid===preferredUid)
    ||matches.find(row=>row.trace_type==='path')||matches[0]||null;
}
