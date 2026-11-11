// Fixed-purpose Keyword operations on the existing LOC Pages application.
// No generic SQL Gateway: the browser can request only four bounded Keyword
// operations, with the same LOC Auth delegation already used by the site.
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
  // No redundant /api/loc-permissions preflight: the same /api/keywords
  // request validates the existing HttpOnly Session and Scope authorization
  // at the trusted server boundary before every protected write.
  const response=await fetch('/api/keywords',{
    method:'POST',credentials:'include',cache:'no-store',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({operation,args}),signal:AbortSignal.timeout(write?180000:25000)
  });
  const payload=await response.json().catch(()=>null);
  if(!response.ok)throw Error(payload?.error||'詞級資料讀取失敗（HTTP '+response.status+'）');
  return payload?.data;
}
