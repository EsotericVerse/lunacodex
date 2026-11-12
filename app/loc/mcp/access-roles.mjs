// LOC MCP access reuses LOC Auth identity and the existing api.manage roles.
// This is a resource-usage gate, NOT an MCP application or a second role registry.
import {directMcpKysely} from './native-kysely.mjs';
import {fixedPolicyReader} from '../../../zenstack/policy-runtime.mjs';
import {ZenStackClient} from '@zenstackhq/orm';
import {PolicyPlugin} from '@zenstackhq/plugin-policy';
import {z} from 'zod';
import {resolveManagePermissions} from '../permissions/roles.mjs';

const AUTH_USERINFO='https://auth.lo3rwang.cc/api/auth/oauth2/userinfo';
const VerifiedEmail=z.email();
export const VerifiedLocUserInfoSchema=z.looseObject({
  sub:z.string().min(1).max(128),
  email:VerifiedEmail,
  email_verified:z.literal(true)
});
function denial(message,httpStatus){
  return Object.assign(new Error(message),{httpStatus});
}

// Role and Grant rules are defined ONCE in the existing ZModel-derived
// Manage schema projection, shared with the LOC website.
export function eligibleMcpRoles(email,rows=[]){
  return resolveManagePermissions(email,rows).roles
    .map(({id,role})=>({id,role}));
}

// One bounded role SELECT shared by MCP tools and the Extension import path.
async function activeMcpRows(db,email){
  return db.selectFrom('api.manage')
    .select(['id','email','manage_role','active'])
    .where(db.fn('lower',['email']),'=',email)
    .where('active','=',true).execute();
}

// Return the shared typed permissions, not another hand-written Grant builder.
export async function locMcpPermissionsForEmail(db,email,{dialect}={}){
  const {permissions}=await authorizeMcpRole(email,{},{
    database:async()=>({db,dialect})
  });
  return permissions;
}

// Read the existing role registry only when an MCP tool is actually requested.
// Fail closed on unavailable SQL, without treating SQL failure as "no role".
export async function authorizeMcpRole(email,env={},{
  database=directMcpKysely
}={}){
  const verified=String(email||'').trim().toLowerCase();
  if(!VerifiedEmail.safeParse(verified).success)
    throw denial('Verified LOC identity required',401);
  let rows;
  try{
    const {db,dialect}=await database(env);
    if(dialect){
      // The existing ZModel Manage @@allow('read',true) policy runs through
      // ZenStack on the same Kysely dialect/pool: no second DB connection.
      const model=fixedPolicyReader(db,{dialect,ZenStackClient,PolicyPlugin});
      rows=await model.manage.findMany({
        where:{email:verified,active:true},
        select:{id:true,email:true,manage_role:true,active:true}
      });
    }else{
      rows=await activeMcpRows(db,verified);
    }
  }catch{
    throw denial('LOC MCP role service unavailable',503);
  }
  const normalized=resolveManagePermissions(verified,rows);
  if(!normalized.roles.length)throw denial('LOC MCP role not granted',403);
  const roles=normalized.roles.map(({id,role})=>({id,role}));
  return {email:verified,roles,permissions:{...normalized,roles}};
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
  if(response?.status===429)throw denial('LOC OAuth UserInfo rate limited',429);
  if(response?.status===401||response?.status===403)
    throw denial('LOC OAuth identity verification failed',401);
  if(!response?.ok)throw denial('LOC OAuth UserInfo unavailable',503);
  const parsed=VerifiedLocUserInfoSchema.safeParse(await response.json().catch(()=>null));
  if(!parsed.success||parsed.data.sub!==subject)
    throw denial('Verified LOC OAuth identity required',401);
  return authorizeMcpRole(parsed.data.email,env,{database});
}
