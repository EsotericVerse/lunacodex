import {EDIT_OPERATION_TTL_MS} from '../edit-session-ttl.mjs';

// UI-only projection of business permissions. Never makes its own grants.
// The server verifies Better Auth's opaque cookie, then checks api.manage.
export async function readLocEditorGrants(session,{fetchImpl=globalThis.fetch}={}){
  if(!session?.user?.id)throw Error('LOC sign-in required');
  const response=await fetchImpl('/api/loc-permissions',{
    method:'GET',credentials:'include',cache:'no-store',
    headers:{accept:'application/json'},signal:AbortSignal.timeout(EDIT_OPERATION_TTL_MS)
  });
  const data=await response.json().catch(()=>null);
  if(!response.ok||!data?.canWrite||!Array.isArray(data.grants))
    throw Error((data?.error||'LOC edit permission denied')+
      ' (HTTP '+response.status+(data?.reason?', '+data.reason:
        data?'':', non-JSON response')+')');
  // Bind ZModel business grants to the SAME Better Auth Session subject.
  // An account switch while a management request is pending must not borrow
  // another identity's roles.
  const email=String(data.email||'').trim().toLowerCase();
  const sessionEmail=String(session.user.email||'').trim().toLowerCase();
  if(String(data.subject||'')!==String(session.user.id)||email!==sessionEmail)
    throw Error('LOC Auth Session 與 ZModel 管理權限身分不一致');
  if(!Array.isArray(data.roles))throw Error('LOC role response invalid');
  // The existing setAuthorization() is the only client ZModel LocPrincipal
  // projection. Do not maintain a parallel role whitelist in this transport.
  return {roles:data.roles,grants:data.grants};
}
