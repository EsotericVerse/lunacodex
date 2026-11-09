// LOC Auth verifies identity and makes the authorization decision.
// api.manage is read through LOC's existing trusted Kysely application,
// never through MCP, the browser, or a public SQL management endpoint.
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const cache=new Map();
const TTL=30000;
export async function locRegistryRoles(env,email,{fetchImpl=globalThis.fetch}={}){
  const normalized=String(email||'').trim().toLowerCase();
  if(!EMAIL.test(normalized))return [];
  const saved=fetchImpl===globalThis.fetch?cache.get(normalized):null;
  if(saved&&saved.expires>Date.now())return saved.rows;
  const secret=String(env?.LOC_DB_PROFILE_SERVICE_TOKEN||'');
  if(secret.length<32)
    throw Object.assign(new Error('LOC Auth registry service token is not configured'),{status:503});
  const url=new URL('https://loc.lo3rwang.cc/api/loc-authority-role');
  url.searchParams.set('email',normalized);
  let response;
  try{
    response=await fetchImpl(url.href,{
      method:'GET',headers:{'x-loc-service-token':secret,accept:'application/json'},
      redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(8000)
    });
  }catch{throw Object.assign(new Error('LOC Auth registry lookup unavailable'),{status:503})}
  if(!response.ok)
    throw Object.assign(new Error('LOC Auth registry lookup failed ('+response.status+')'),{status:503});
  const result=await response.json().catch(()=>null);
  if(!Array.isArray(result?.rows)||result.rows.length>64)
    throw Object.assign(new Error('Invalid LOC Auth registry response'),{status:503});
  const roles=result.rows.filter(row=>row&&
    String(row.email||'').trim().toLowerCase()===normalized&&
    SCOPE.test(String(row.id||''))&&
    ['admin','group','scope'].includes(row.role)&&
    row.active===true).map(row=>({id:row.id,role:row.role}));
  if(fetchImpl===globalThis.fetch)cache.set(normalized,{expires:Date.now()+TTL,rows:roles});
  return roles;
}
export const isLocRegistryAdmin=rows=>Array.isArray(rows)&&
  rows.some(row=>row.role==='admin');
export const canLocRegistryManage=(rows,scope)=>{
  const id=String(scope||'').toLowerCase();
  return isLocRegistryAdmin(rows)||Array.isArray(rows)&&
    rows.some(row=>row.id===id&&(row.role==='scope'||row.role==='group'));
};
