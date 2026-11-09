// LOC Auth verifies identity and makes the authorization decision.
// api.manage is the sole source of management roles. The primary lookup uses
// LOC's trusted Kysely application; only a backend outage enables the existing
// public Data API SELECT to break the control-profile bootstrap deadlock.
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const cache=new Map();
const TTL=30000;
// When the native control profile has not been registered yet, Kysely cannot
// read api.manage, and the LOC owner cannot open the existing database editor
// to register it. Recover this ONE public SELECT through LOC's already
// configured public Data API. This does not issue grants from a second source,
// authorize SQL writes, use Supabase Auth, or expose database credentials.
async function publicRegistryRecovery(env,email,fetchImpl){
 const base=String(env?.LOC_SUPABASE_AUTH_ORIGIN||'').trim();
 const apiKey=String(env?.LOC_SUPABASE_PUBLIC_KEY||'').trim();
 if(!base||!apiKey)throw Object.assign(
  new Error('LOC public registry recovery is not configured'),{status:503});
 let target;
 try{
  const root=new URL(base);
  if(root.protocol!=='https:'||root.username||root.password||
   root.pathname!=='/'||root.search||root.hash)
    throw new Error('Invalid public registry origin');
  target=new URL('/rest/v1/manage',root);
 }catch{throw Object.assign(new Error('Invalid LOC public registry origin'),{status:503});}
 target.searchParams.set('select','id,email,manage_role,active');
 target.searchParams.set('email','ilike.'+email);
 target.searchParams.set('limit','64');
 let response;
 try{
  response=await fetchImpl(target.href,{
   method:'GET',headers:{apikey:apiKey,'accept-profile':'api',
    accept:'application/json'},
   redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(8000)
  });
 }catch{throw Object.assign(new Error('LOC public registry recovery unavailable'),{status:503});}
 if(!response.ok)
  throw Object.assign(new Error('LOC public registry recovery failed ('+response.status+')'),
   {status:503});
 const rows=await response.json().catch(()=>null);
 if(!Array.isArray(rows)||rows.length>64)
  throw Object.assign(new Error('Invalid LOC public registry recovery'),{status:503});
 return rows.map(row=>({
  id:row?.id,email:row?.email,role:row?.manage_role,active:row?.active
 }));
}
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
  }catch{response={ok:false,status:503};}
  // A refused service token (403) must never trigger a public fallback.
  // Only a broken trusted backend (5xx), e.g. a missing loc-main profile,
  // may recover the identical api.manage facts via the existing public read.
  const result=response.status>=500
    ?{rows:await publicRegistryRecovery(env,normalized,fetchImpl)}
    :response.ok?await response.json().catch(()=>null):null;
  if(!response.ok&&response.status<500)
    throw Object.assign(new Error('LOC Auth registry lookup failed ('+response.status+')'),{status:503});
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
