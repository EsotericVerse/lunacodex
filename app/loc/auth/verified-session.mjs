// Server-side verification against Better Auth's own /get-session endpoint.
// This is a relying-party call, not a second Session/JWT implementation.
const ISSUER='https://auth.lo3rwang.cc';
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function err(message,status){
  return Object.assign(new Error(message),{httpStatus:status});
}
export async function verifiedLocWebsiteSession(request,{
  fetchImpl=globalThis.fetch
}={}){
  const cookie=request.headers.get('cookie')||'';
  if(!cookie)throw err('LOC sign-in required',401);
  let response;
  try{
    response=await fetchImpl(ISSUER+'/api/auth/get-session',{
      method:'GET',headers:{cookie,accept:'application/json'},
      cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(7000)
    });
  }catch{throw err('LOC Auth unavailable',503)}
  if(!response.ok)throw err('LOC Auth unavailable',503);
  const data=await response.json().catch(()=>null);
  const user=data?.user;
  if(!data?.session||user?.emailVerified!==true||
     typeof user.id!=='string'||!user.id||
     !EMAIL.test(String(user.email||'')))
    throw err('Verified LOC sign-in required',401);
  return {userId:user.id,email:String(user.email).trim().toLowerCase()};
}
