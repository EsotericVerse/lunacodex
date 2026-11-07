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

// Group Authority verifies the *currently published* Class directory from
// a fixed read-only LOC application operation, never an SQL transport.
export async function readPublicKeywordClasses(scopeid,{fetchImpl=fetch}={}){
  if(!SCOPE.test(String(scopeid||'')))
    throw Object.assign(new Error('Invalid Scope'),{status:400});
  const url='https://mcp.lo3rwang.cc/api/loc-public-classes?scopeid='+
    encodeURIComponent(scopeid);
  const response=await fetchImpl(url,{
    method:'GET',headers:{accept:'application/json'},credentials:'omit',
    redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000)
  });
  if(!response.ok)
    throw Object.assign(new Error('Public Class verification unavailable'),{status:503});
  const payload=await response.json().catch(()=>null);
  if(!Array.isArray(payload?.data))
    throw Object.assign(new Error('Invalid public Class directory'),{status:502});
  return payload.data.filter(row=>row?.scopeId===scopeid&&
    CLASS_UID.test(String(row.classUid||'')));
}
export async function assertPublicKeywordClass(scopeid,classUid,options){
  const rows=await readPublicKeywordClasses(scopeid,options);
  if(!rows.some(row=>row.classUid===classUid))
    throw Object.assign(new Error('Only a public Class UID may be imported'),{status:403});
  return true;
}
