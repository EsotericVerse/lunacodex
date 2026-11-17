// Server-side verification against Better Auth's own /get-session endpoint.
// This is a relying-party call, not a second Session/JWT implementation.
// LOC Auth verifies identity only; LOC Web independently evaluates api.manage/Scope grants.
const ISSUER='https://auth.lo3rwang.cc';
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function err(message,status,reason){
  return Object.assign(new Error(message),{httpStatus:status,reason});
}
export async function verifiedLocWebsiteSession(request,{
  fetchImpl=globalThis.fetch
}={}){
  const cookie=request.headers.get('cookie')||'';
  if(!cookie)throw err('LOC sign-in required',401,'no_cookie');
  let response;
  try{
    // Reuse the existing signed Session Cookie Cache; no forced Auth DB
    // lookup for each privileged website operation.
    response=await fetchImpl(ISSUER+'/api/auth/get-session',{
      method:'GET',headers:{cookie,accept:'application/json'},
      cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(7000)
    });
  }catch{throw err('LOC Auth unavailable',503,'auth_unreachable')}
  // RFC 9110: missing authentication, forbidden identity, throttling and
  // upstream unavailability are different HTTP outcomes. Do not translate a
  // genuine 403 into a 401 (which would incorrectly suggest signing in again).
  if(response.status===401)
    throw err('LOC sign-in required',401,'auth_status_401');
  if(response.status===403)
    throw err('LOC identity verification forbidden',403,'auth_status_403');
  if(response.status===429)
    throw err('LOC identity verification rate limited',429,'auth_status_429');
  if(!response.ok)
    throw err('LOC Auth unavailable',response.status>=500?503:502,
      'auth_status_'+response.status);
  const data=await response.json().catch(()=>null);
  const user=data?.user;
  if(!data?.session)throw err('Verified LOC sign-in required',401,'no_session');
  if(user?.emailVerified!==true)
    throw err('Verified LOC sign-in required',401,'email_unverified');
  if(typeof user.id!=='string'||!user.id||!EMAIL.test(String(user.email||'')))
    throw err('Verified LOC sign-in required',401,'bad_user');
  return {userId:user.id,email:String(user.email).trim().toLowerCase()};
}
