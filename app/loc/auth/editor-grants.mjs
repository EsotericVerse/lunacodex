import {EDIT_OPERATION_TTL_MS} from '../edit-session-ttl.mjs';

// Manage RC5: a single trusted website endpoint verifies Better Auth's
// Session and reads ZModel/PolicyPlugin api.manage rights. The browser no
// longer repeats getSession() before requesting the same verified identity.
// A signed-in user without a business role stays signed in, but has no grant.
export async function readLocEditorGrants({fetchImpl=globalThis.fetch}={}){
  const response=await fetchImpl('/api/loc-permissions',{
    method:'GET',credentials:'include',cache:'no-store',
    headers:{accept:'application/json'},signal:AbortSignal.timeout(EDIT_OPERATION_TTL_MS)
  });
  const data=await response.json().catch(()=>null);
  if(!response.ok){
    const error=new Error((data?.error||'LOC edit permission denied')+
      ' (HTTP '+response.status+(data?.reason?', '+data.reason:
        data?'':', non-JSON response')+')');
    error.status=response.status;
    throw error;
  }
  // The server's subject/email come from an authoritative Better Auth
  // Session, never request arguments. They are NOT browser-issued claims.
  const id=String(data?.subject||'');
  const email=String(data?.email||'').trim().toLowerCase();
  if(!id||!email||!Array.isArray(data?.roles)||
     !Array.isArray(data?.grants))
    throw Error('LOC Auth 與 ZModel 管理權限回應不完整');
  // The established setAuthorization() is the only client-side ZModel role
  // projection. A Session alone does not grant any LOC Web write permission.
  return {user:{id,email},roles:data.roles,grants:data.grants};
}
