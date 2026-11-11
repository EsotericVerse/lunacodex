// Business write preflight, not a token issuer.
// Public reads bypass Auth entirely. The website backend authorizes writes
// through its own Better Auth session validation and api.manage roles.
const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
export async function locDelegation(scope,write){
  if(!SCOPE.test(String(scope||'')))throw Error('Invalid LOC Scope');
  if(!write)return '';
  const res=await fetch('/api/loc-permissions',{
    method:'GET',credentials:'include',cache:'no-store',
    headers:{accept:'application/json'},signal:AbortSignal.timeout(8000)
  });
  const rights=await res.json().catch(()=>null);
  if(!res.ok||!rights?.canWrite||!
    (rights.grants?.includes('global:manage')||
     rights.grants?.includes(scope+':manage')))
    throw Error('LOC Scope write permission denied');
  // Identity travels through Better Auth's opaque HttpOnly cookie,
  // never an invented browser-generated delegation token.
  return '';
}
