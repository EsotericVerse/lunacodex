// UI-only projection of business permissions. Never makes its own grants.
// The server verifies Better Auth's opaque cookie, then checks api.manage.
export async function readLocEditorGrants(session,{fetchImpl=globalThis.fetch}={}){
  if(!session?.user?.id)throw Error('LOC sign-in required');
  const response=await fetchImpl('/api/loc-permissions',{
    method:'GET',credentials:'include',cache:'no-store',
    headers:{accept:'application/json'},signal:AbortSignal.timeout(20000)
  });
  const data=await response.json().catch(()=>null);
  if(!response.ok||!data?.canWrite||!Array.isArray(data.grants))
    throw Error((data?.error||'LOC edit permission denied')+
      ' (HTTP '+response.status+(data?.reason?', '+data.reason:
        data?'':', non-JSON response')+')');
  if(!Array.isArray(data.roles))throw Error('LOC role response invalid');
  const email=String(data.email||'').trim().toLowerCase();
  return data.roles.filter(row=>
    row?.email===email&&['admin','group','scope'].includes(row.role)&&
    /^[a-z][a-z0-9]{0,14}$/.test(String(row.id||''))
  ).map(row=>({id:row.id,email,role:row.role,manage_role:row.role}));
}
