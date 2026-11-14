// Fixed-purpose Keyword operations on the existing LOC Pages application.
// Better Auth Session and api.manage ZModel rights are verified once by the
// destination API, then again only inside the protected write transaction.
// Do not preflight /api/loc-permissions and duplicate both network checks.
const SCOPE=/^[a-z][a-z0-9]{0,14}$/;

export async function keywordService(operation,args={}){
  if(!['analyze','reset','classes','catalog','summary','stats','suggest',
      'anchorSearch','saveItem','deleteItem','syncLibrary'].includes(operation))
    throw Error('Unsupported Keyword operation');
  if(!args||typeof args!=='object'||Array.isArray(args))
    throw Error('Invalid Keyword request');
  const scope=String(args.scopeId||'');
  if(!SCOPE.test(scope))
    throw Error('Invalid Keyword Scope');
  const write=['analyze','reset','saveItem','deleteItem','syncLibrary'].includes(operation);
  const response=await fetch('/api/keywords',{
    method:'POST',credentials:'include',cache:'no-store',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({operation,args}),signal:AbortSignal.timeout(write?180000:25000)
  });
  const payload=await response.json().catch(()=>null);
  if(!response.ok)throw Error(payload?.error||'詞級資料讀取失敗（HTTP '+response.status+'）');
  return payload?.data;
}
