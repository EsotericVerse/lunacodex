// Server-side verification against Better Auth's own /get-session endpoint.
// This is a relying-party call, not a second Session/JWT implementation.
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
    // This verifier is used for privileged website operations; signed
    // session_data Cookie Cache must not extend access after revocation.
    response=await fetchImpl(ISSUER+'/api/auth/get-session?disableCookieCache=true',{
      method:'GET',headers:{cookie,accept:'application/json'},
      cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(7000)
    });
  }catch{throw err('LOC Auth unavailable',503,'auth_unreachable')}
  if(response.status===401||response.status===403)
    throw err('LOC sign-in required',401,'auth_status_'+response.status);
  if(!response.ok)throw err('LOC Auth unavailable',503,'auth_status_'+response.status);
  const data=await response.json().catch(()=>null);
  const user=data?.user;
  if(!data?.session)throw err('Verified LOC sign-in required',401,'no_session');
  if(user?.emailVerified!==true)
    throw err('Verified LOC sign-in required',401,'email_unverified');
  if(typeof user.id!=='string'||!user.id||!EMAIL.test(String(user.email||'')))
    throw err('Verified LOC sign-in required',401,'bad_user');
  return {userId:user.id,email:String(user.email).trim().toLowerCase()};
}
