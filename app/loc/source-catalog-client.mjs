// The only browser interface for editing LOC system / Scope Source catalog.
// A verified LOC delegation travels to one fixed-purpose same-origin Pages
// endpoint. Browser never receives DB credentials or unrestricted SQL.
import {locDelegation} from './auth/browser-delegation.mjs';
const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
export async function sourceCatalogService(operation,scopeId,values=null){
  const scope=String(scopeId||'');
  if(!SCOPE.test(scope)||!['read','save_scope','save_system'].includes(operation))
    throw new Error('Invalid LOC Source request');
  if(operation==='save_system'&&scope!=='loc'||operation==='save_scope'&&scope==='loc')
    throw new Error('Invalid Source owner');
  // The existing LOC editor acquires its Scope/Group snapshot with self:true.
  // The trusted native action, not the browser, checks ownership on every write.
  const token=await locDelegation(scope,false);
  // No unauthenticated catalogue in the management editor, including reads.
  if(!token)throw new Error('LOC 管理授權尚未就緒');
  const payload={operation,scopeId:scope};
  if(operation==='save_system')payload.names=values;
  if(operation==='save_scope')payload.sources=values;
  const response=await fetch('/api/source-catalog',{
    method:'POST',credentials:'omit',cache:'no-store',
    headers:{'content-type':'application/json',authorization:'Bearer '+token},
    body:JSON.stringify(payload),signal:AbortSignal.timeout(25000)
  });
  const result=await response.json().catch(()=>null);
  if(!response.ok)throw new Error(result?.error||'LOC 來源管理失敗（HTTP '+response.status+'）');
  if(!result||!Object.hasOwn(result,'data'))
    throw new Error('LOC Source 回傳資料不完整');
  return result.data;
}
