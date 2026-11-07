// Category metadata belongs to the Scope Group. Identity matches
// read_shared_keyword_classes: SHA-256(UTF8(scopeid + ':' + Class UID)).
const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const CLASS_UID=/^(?:[A-Za-z0-9]{4}|[A-Za-z0-9]{8})$/;
export function validateKeywordCategoryEntry(groupid,scopeid,classUid,members=[]){
  if(!SCOPE.test(String(groupid||''))||!SCOPE.test(String(scopeid||''))||
      !CLASS_UID.test(String(classUid||'')))
    throw Object.assign(new Error('Invalid keyword Category identifier'),{status:400});
  if(groupid===scopeid||!members.includes(scopeid))
    throw Object.assign(new Error('Scope is not a Group member'),{status:403});
  return {scopeid,class:String(classUid)};
}
export async function hashKeywordCategory(scopeid,classUid){
  const bytes=new TextEncoder().encode(scopeid+':'+classUid);
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}

// The Group authority rechecks the *public* Class-only RPC on every import.
// Do not trust a browser's UID or a prior public/private state.
export async function readPublicKeywordClasses(scopeid,{fetchImpl=fetch,env={}}={}){
  if(!SCOPE.test(String(scopeid||'')))
    throw Object.assign(new Error('Invalid Scope'),{status:400});
  // The public Class directory is read through LOC's independent SQL
  // Gateway. The removed database RPC and vendor Data API are never called.
  const endpoint=String(env.LOC_SQL_GATEWAY_URL||env.LOC_MCP_SQL_GATEWAY_URL||'').trim();
  let url;
  try{
    url=new URL(endpoint);
    if(url.protocol!=='https:'||url.pathname!=='/v1/sql'||url.search||
      url.hash||url.username||url.password)throw new Error('Invalid endpoint');
  }catch{
    throw Object.assign(new Error('LOC SQL Gateway is not configured'),{status:503});
  }
  const response=await fetchImpl(url.href,{
    method:'POST',headers:{'content-type':'application/json','accept':'application/json'},
    body:JSON.stringify({kind:'analytics',target:'configured',
      args:{p_scope_id:scopeid,p_view:'shared_classes',p_start:null,p_end:null,p_options:{}}}),
    credentials:'omit',redirect:'error',signal:AbortSignal.timeout(8000)
  });
  if(!response.ok)
    throw Object.assign(new Error('Public Class verification unavailable'),{status:503});
  const payload=await response.json();
  if(!Array.isArray(payload?.data))
    throw Object.assign(new Error('Invalid public Class directory'),{status:502});
  // SQL Gateway projects only public, type=class rows for anonymous access.
  return payload.data.filter(row=>row?.scopeId===scopeid&&CLASS_UID.test(row.classUid));
}
export async function assertPublicKeywordClass(scopeid,classUid,options){
  const rows=await readPublicKeywordClasses(scopeid,options);
  if(!rows.some(row=>row.classUid===classUid))
    throw Object.assign(new Error('Only a public Class UID may be imported'),{status:403});
  return true;
}
