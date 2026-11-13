// MCP uses the exact same api.manage ZModel/PolicyPlugin role reader as Web.
// Its grants remain restricted to active records: virtual Admin is web-only.
import {directMcpKysely} from './native-kysely.mjs';
import {z} from 'zod';
import {readLocAccess} from '../permissions/loc_access.mjs';

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

// One bounded role SELECT, shared by MCP/Extension and website. No extra
// activeMcpRows Kysely implementation or separate grant builder.
export async function loadMcpLocAccess(db,email,{dialect,engine}={}){
  const rights=await readLocAccess(db,email,{dialect,engine});
  if(!rights.roles.length)throw denial('LOC MCP role not granted',403);
  return rights;
}

export async function authorizeMcpRole(email,env={},{
  database=directMcpKysely
}={}){
  const verified=String(email||'').trim().toLowerCase();
  if(!VerifiedEmail.safeParse(verified).success)
    throw denial('Verified LOC identity required',401);
  let permissions;
  try{
    const {db,dialect,engine}=await database(env);
    permissions=await readLocAccess(db,verified,{dialect,engine});
  }catch{
    throw denial('LOC MCP role service unavailable',503);
  }
  if(!permissions.roles.length)throw denial('LOC MCP role not granted',403);
  return {email:verified,roles:permissions.roles.map(({id,role})=>({id,role})),
    permissions};
}

// The verified RFC 9068 token and UserInfo bind identity to the same Session;
// no browser-supplied role or new black/allow list can elevate access.
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
