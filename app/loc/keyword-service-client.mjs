// Fixed-purpose Keyword operations on the existing LOC Pages application.
// No generic SQL Gateway: the browser can request only four bounded Keyword
// operations, with the same LOC Auth delegation already used by the site.
import {locDelegation} from './auth/browser-delegation.mjs';

export async function keywordService(operation,args={}){
  if(!['analyze','reset','classes','catalog','summary','stats','suggest'].includes(operation))
    throw Error('Unsupported Keyword operation');
  if(!args||typeof args!=='object'||Array.isArray(args))
    throw Error('Invalid Keyword request');
  const scope=String(args.scopeId||'');
  if(operation!=='suggest'&&!SCOPE.test(scope))
    throw Error('Invalid Keyword Scope');
  const write=operation==='analyze'||operation==='reset';
  const token=await locDelegation(scope,write);
  const response=await fetch('/api/keywords',{
    method:'POST',credentials:'omit',cache:'no-store',
    headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},
    body:JSON.stringify({operation,args}),signal:AbortSignal.timeout(write?180000:25000)
  });
  const payload=await response.json().catch(()=>null);
  if(!response.ok)throw Error(payload?.error||'詞級資料讀取失敗（HTTP '+response.status+'）');
  return payload?.data;
}
