// Resolve the *clicked* edit entry at the existing LOC Auth issuer.
// Never query a management SQL table to establish a browser edit session.
// This response is a UI preflight only; authenticated server writes must
// independently verify the signed LOC delegation and requested operation.
const LOC_AUTH='https://auth.lo3rwang.cc';
const SUBJECT=/^loc_[A-Za-z0-9_-]{32,80}$/;
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GRANT=/^([a-z][a-z0-9]{0,14}):manage$/;
function trustedOrigin(value){
  const url=new URL(String(value||LOC_AUTH));
  if(url.protocol!=='https:'||url.username||url.password||
     url.search||url.hash||!['','/'].includes(url.pathname))
    throw new Error('LOC Auth origin is invalid');
  return url.origin;
}
export async function readLocEditorGrants(session,{
  fetchImpl=globalThis.fetch,
  authorityOrigin=LOC_AUTH,
  scopeKinds={}
}={}){
  const user=session?.user;
  const token=session?.session?.access_token;
  const email=String(user?.email||'').trim().toLowerCase();
  if(!SUBJECT.test(String(user?.id||''))||!EMAIL.test(email)||
     typeof token!=='string'||token.split('.').length!==3)
    throw new Error('LOC Auth verified session required');
  if(typeof fetchImpl!=='function')throw new Error('LOC Auth transport unavailable');
  const response=await fetchImpl(trustedOrigin(authorityOrigin)+'/v1/delegation',{
    method:'POST',
    headers:{authorization:'Bearer '+token,'content-type':'application/json',accept:'application/json'},
    body:JSON.stringify({audience:'sql',self:true}),
    credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(8000)
  });
  if(response.status===428){
    // First-time, version-updated or revoked consent: hand off once to LOC
    // Auth's owned data contract, then return to the original edit page.
    const body=await response.json().catch(()=>({}));
    const consent=new URL(String(body?.consent_url||'/oauth/consent/web'),
      trustedOrigin(authorityOrigin));
    if(consent.origin!==trustedOrigin(authorityOrigin)||
       consent.pathname!=='/oauth/consent/web')
      throw new Error('LOC Auth 資料合約網址無效');
    if(typeof window!=='undefined'&&window.location){
      const path=window.location.pathname+window.location.search;
      consent.searchParams.set('return_to',
        path.startsWith('/')&&!path.startsWith('//')?path:'/local/settings/');
      if(/\/(?:manage|admin)(?:\/|$)/.test(window.location.pathname))
        try{window.sessionStorage.setItem('loc-management-login-return-v1',path)}catch{}
      window.location.assign(consent.href);
    }
    throw new Error('LOC Auth 資料合約尚未確認');
  }
  if(!response.ok)throw new Error('LOC Auth 編輯授權失敗（HTTP '+response.status+'）');
  const data=await response.json();
  if(data?.audience!=='loc-delegation'||!Array.isArray(data.grants)||
     data.grants.length>64||data.grants.some(x=>
       x!=='global:manage'&&!GRANT.test(String(x))))
    throw new Error('LOC Auth 編輯授權回應不完整');
  // The signed LOC Auth grants, not a browser email whitelist, drive the UI.
  const result=[];
  const seen=new Set();
  for(const grant of data.grants){
    if(seen.has(grant))continue;
    seen.add(grant);
    if(grant==='global:manage'){
      result.push({id:'admin',email,role:'admin',manage_role:'admin'});
      continue;
    }
    const scope=GRANT.exec(grant)?.[1];
    if(!scope)continue;
    result.push({id:scope,email,role:'admin',manage_role:'admin'});
  }
  return result;
}
