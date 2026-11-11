// Server-side verification against Better Auth's own /get-session endpoint.
// This is a relying-party call, not a second Session/JWT implementation.
const ISSUER='https://auth.lo3rwang.cc';
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Reuse a *previously verified* Better Auth Session within this Pages worker.
// This is an identity result cache, not a token issuer or a permission grant.
// It avoids a second Auth network round trip for repeated editor saves on the
// same worker isolate. A new isolate must still perform an initial verification.
const VERIFIED_SESSION_TTL_MS=30*60*1000;
const MAX_VERIFIED_SESSIONS=256;
const verifiedSessions=new Map();
const inFlight=new Map();
async function cookieFingerprint(cookie){
  const bytes=new TextEncoder().encode(cookie);
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}
function rememberVerifiedSession(key,identity,now){
  verifiedSessions.delete(key);
  verifiedSessions.set(key,{identity,expiresAt:now+VERIFIED_SESSION_TTL_MS});
  while(verifiedSessions.size>MAX_VERIFIED_SESSIONS)
    verifiedSessions.delete(verifiedSessions.keys().next().value);
}
function err(message,status,reason){
  return Object.assign(new Error(message),{httpStatus:status,reason});
}
export async function verifiedLocWebsiteSession(request,{
  fetchImpl=globalThis.fetch
}={}){
  const cookie=request.headers.get('cookie')||'';
  if(!cookie)throw err('LOC sign-in required',401,'no_cookie');
  const key=await cookieFingerprint(cookie);
  const now=Date.now();
  const cached=verifiedSessions.get(key);
  if(cached&&cached.expiresAt>now)return cached.identity;
  if(cached)verifiedSessions.delete(key);
  const pending=inFlight.get(key);
  if(pending)return pending;
  const verify=verifySessionWithBetterAuth(cookie,fetchImpl);
  inFlight.set(key,verify);
  try{
    const identity=await verify;
    rememberVerifiedSession(key,identity,Date.now());
    return identity;
  }finally{
    if(inFlight.get(key)===verify)inFlight.delete(key);
  }
}
async function verifySessionWithBetterAuth(cookie,fetchImpl){
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
