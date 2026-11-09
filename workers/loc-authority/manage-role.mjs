// LOC Auth's management authority is api.manage, never a code-defined email.
// This is a READ of the existing public registry using the configured Data API.
// It neither logs in through the database nor grants direct browser writes.
const EMAIL=/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const cache=new Map();
const TTL=30000;
export async function locRegistryRoles(env,email,{fetchImpl=globalThis.fetch}={}){
  const normalized=String(email||'').trim().toLowerCase();
  if(!EMAIL.test(normalized))return [];
  const saved=fetchImpl===globalThis.fetch?cache.get(normalized):null;
  if(saved&&saved.expires>Date.now())return saved.rows;
  const origin=String(env?.LOC_SUPABASE_AUTH_ORIGIN||'');
  const key=String(env?.LOC_SUPABASE_PUBLIC_KEY||'');
  let base;
  try{base=new URL(origin)}catch{throw Object.assign(new Error('LOC Auth registry URL not configured'),{status:503})}
  if(base.protocol!=='https:'||base.username||base.password||
     base.search||base.hash||!['','/'].includes(base.pathname)||!key)
    throw Object.assign(new Error('LOC Auth registry lookup not configured'),{status:503});
  const url=new URL('/rest/v1/manage',base);
  url.searchParams.set('select','id,email,manage_role,active');
  url.searchParams.set('email','eq.'+normalized);
  url.searchParams.set('limit','64');
  let response;
  try{
    response=await fetchImpl(url.href,{
      method:'GET',headers:{apikey:key,'accept-profile':'api',accept:'application/json'},
      redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000)
    });
  }catch{throw Object.assign(new Error('LOC Auth registry lookup unavailable'),{status:503})}
  if(!response.ok)
    throw Object.assign(new Error('LOC Auth registry lookup failed ('+response.status+')'),{status:503});
  const raw=await response.json().catch(()=>null);
  if(!Array.isArray(raw)||raw.length>64)
    throw Object.assign(new Error('Invalid LOC Auth registry response'),{status:503});
  const rows=raw.filter(row=>row&&
    String(row.email||'').trim().toLowerCase()===normalized&&
    SCOPE.test(String(row.id||''))&&
    ['admin','group','scope'].includes(row.manage_role)&&
    row.active===true).map(row=>({id:row.id,role:row.manage_role}));
  if(fetchImpl===globalThis.fetch)cache.set(normalized,{expires:Date.now()+TTL,rows});
  return rows;
}
export const isLocRegistryAdmin=rows=>Array.isArray(rows)&&
  rows.some(row=>row.role==='admin');
export const canLocRegistryManage=(rows,scope)=>{
  const id=String(scope||'').toLowerCase();
  return isLocRegistryAdmin(rows)||Array.isArray(rows)&&
    rows.some(row=>row.id===id&&(row.role==='scope'||row.role==='group'));
};
