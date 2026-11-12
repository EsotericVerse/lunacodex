// LOC MCP access reuses LOC Auth identity and the existing api.manage roles.
// This is a resource-usage gate, NOT an MCP application or a second role registry.
import {directMcpKysely} from './native-kysely.mjs';

const AUTH_USERINFO='https://auth.lo3rwang.cc/api/auth/oauth2/userinfo';
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES=new Set(['admin','group','scope']);
function denial(message,httpStatus){
  return Object.assign(new Error(message),{httpStatus});
}

export function eligibleMcpRoles(email,rows=[]){
  const verified=String(email||'').trim().toLowerCase();
  if(!EMAIL.test(verified)||!Array.isArray(rows))return [];
  const found=new Map();
  for(const row of rows){
    const id=String(row?.id||'').trim();
    const role=String(row?.manage_role||'').trim().toLowerCase();
    if(!id||row?.active!==true||!ROLES.has(role)||
      String(row?.email||'').trim().toLowerCase()!==verified)continue;
    found.set(id+':'+role,{id,role});
  }
  return [...found.values()];
}

// One bounded role SELECT shared by MCP tools and the Extension import path.
async function activeMcpRows(db,email){
  return db.selectFrom('api.manage')
    .select(['id','email','manage_role','active'])
    .where(db.fn('lower',['email']),'=',email)
    .where('active','=',true).execute();
}

const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
// Business grants are derived solely from active role rows for the verified
// identity. Scope/Group never silently inherit global Admin or child Scopes.
export async function locMcpPermissionsForEmail(db,email){
  const {roles:assigned}=await authorizeMcpRole(email,{},{
    database:async()=>({db})
  });
  const roles=assigned.filter(row=>SCOPE.test(row.id));
  if(!roles.length)throw denial('LOC MCP Scope not granted',403);
  const grants=new Set();
  for(const {id,role} of roles){
    if(role==='admin')grants.add('global:manage');
    grants.add(id+':manage');
    grants.add(id+':write');
    grants.add(id+':read');
  }
  return {canWrite:true,canManage:grants.has('global:manage'),
    roles,grants:[...grants]};
}

// Read the existing role registry only when an MCP tool is actually requested.
// Fail closed on unavailable SQL, without treating SQL failure as "no role".
export async function authorizeMcpRole(email,env={},{
  database=directMcpKysely
}={}){
  const verified=String(email||'').trim().toLowerCase();
  if(!EMAIL.test(verified))throw denial('Verified LOC identity required',401);
  let rows;
  try{
    const {db}=await database(env);
    rows=await activeMcpRows(db,verified);
  }catch{
    throw denial('LOC MCP role service unavailable',503);
  }
  const roles=eligibleMcpRoles(verified,rows);
  if(!roles.length)throw denial('LOC MCP role not granted',403);
  return {email:verified,roles};
}

// The RFC 9068 access token has already been verified by the MCP router.
// UserInfo binds the verified email to the same LOC Auth subject; never trust
// caller-supplied email, a browser role flag, or a provider access token.
export async function authorizeMcpBearer(token,subject,env={},{
  fetchImpl=globalThis.fetch,database=directMcpKysely
}={}){
  if(!token||typeof subject!=='string'||!subject)
    throw denial('LOC OAuth access token required',401);
  let response;
  try{
    response=await fetchImpl(AUTH_USERINFO,{method:'GET',
      headers:{authorization:'Bearer '+token,accept:'application/json'},
      cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(7000)});
  }catch{
    throw denial('LOC OAuth UserInfo unavailable',503);
  }
  if(!response?.ok)throw denial('LOC OAuth identity verification failed',401);
  const user=await response.json().catch(()=>null);
  if(user?.sub!==subject||user?.email_verified!==true)
    throw denial('Verified LOC OAuth identity required',401);
  return authorizeMcpRole(user.email,env,{database});
}
