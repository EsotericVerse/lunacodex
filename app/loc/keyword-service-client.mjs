// Fixed-purpose Keyword operations on the existing LOC Pages application.
// No generic SQL Gateway: the browser can request only four bounded Keyword
// operations, with the same LOC Auth delegation already used by the site.
import {dbAuthEvents} from './db-client.mjs';

const AUTHORITY='https://auth.lo3rwang.cc';
const SCOPE=/^[a-z][a-z0-9]{0,14}$/;

async function delegation(scope,write){
  let access='';
  try{access=String(await dbAuthEvents.getAccessToken()||'');}
  catch(error){if(write)throw error;return '';}
  if(!access){if(write)throw Error('請先登入 LOC Auth');return '';}
  const request=write?
    {audience:'sql',scopeid:scope,actions:['manage']}:
    {audience:'sql',self:true};
  const result=await fetch(AUTHORITY+'/v1/delegation',{
    method:'POST',credentials:'omit',cache:'no-store',
    headers:{authorization:'Bearer '+access,'content-type':'application/json'},
    body:JSON.stringify(request),signal:AbortSignal.timeout(8000)
  });
  if(!result.ok){
    if(!write&&result.status===403)return '';
    throw Error('LOC Scope 授權失敗（HTTP '+result.status+'）');
  }
  const payload=await result.json();
  if(typeof payload?.access_token!=='string'||payload.access_token.split('.').length!==3)
    throw Error('LOC 委託憑證無效');
  return payload.access_token;
}

export async function keywordService(operation,args={}){
  if(!['analyze','classes','catalog','summary','stats','suggest'].includes(operation))
    throw Error('Unsupported Keyword operation');
  if(!args||typeof args!=='object'||Array.isArray(args))
    throw Error('Invalid Keyword request');
  const scope=String(args.scopeId||'');
  if(operation!=='suggest'&&!SCOPE.test(scope))
    throw Error('Invalid Keyword Scope');
  const write=operation==='analyze';
  const token=await delegation(scope,write);
  const response=await fetch('/api/keywords',{
    method:'POST',credentials:'omit',cache:'no-store',
    headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},
    body:JSON.stringify({operation,args}),signal:AbortSignal.timeout(write?180000:25000)
  });
  const payload=await response.json().catch(()=>null);
  if(!response.ok)throw Error(payload?.error||'詞級資料讀取失敗（HTTP '+response.status+'）');
  return payload?.data;
}
