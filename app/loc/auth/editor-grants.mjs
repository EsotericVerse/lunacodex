// UI-only projection of business permissions. Never makes its own grants.
// The server verifies Better Auth's opaque cookie, then checks api.manage.
export async function readLocEditorGrants(session,{fetchImpl=globalThis.fetch}={}){
  if(!session?.user?.id)throw Error('LOC sign-in required');
  const response=await fetchImpl('/api/loc-permissions',{
    method:'GET',credentials:'include',cache:'no-store',
    headers:{accept:'application/json'},signal:AbortSignal.timeout(8000)
  });
  const data=await response.json().catch(()=>null);
  if(!response.ok||!data?.canWrite||!Array.isArray(data.grants))
    throw Error(data?.error||'LOC edit permission denied');
  const email=String(data.email||'').trim().toLowerCase();
  const grants=[...new Set(data.grants)];
  const results=[];
  if(grants.includes('global:manage'))
    results.push({id:'admin',email,role:'admin',manage_role:'admin'});
  for(const value of grants){
    const id=/^([a-z][a-z0-9]{0,14}):manage$/.exec(value)?.[1];
    if(id)results.push({id,email,role:'admin',manage_role:'admin'});
  }
  return results;
}
