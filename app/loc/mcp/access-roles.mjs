// LOC's published JS Manage Registry determines roles after signed OAuth
// identity. Role checks must not open a PostgreSQL connection or query
// api.manage; only actual business transactions may open the database.
import {z} from 'zod';
import {readLocAccess} from '../permissions/loc_access.mjs';

const AUTH_USERINFO='https://auth.lo3rwang.cc/api/auth/oauth2/userinfo';
export const VerifiedLocUserInfoSchema=z.looseObject({
  sub:z.string().min(1).max(128),
  email:z.email(),
  email_verified:z.literal(true)
});
function denial(message,httpStatus){
  return Object.assign(new Error(message),{httpStatus});
}

export async function loadMcpLocAccess(_db,email){
  const rights=await readLocAccess(null,email,{website:false});
  if(!rights.roles.length)throw denial('LOC MCP role not granted',403);
  return rights;
}

export async function authorizeMcpRole(email){
  const verified=String(email||'').trim().toLowerCase();
  if(!z.email().safeParse(verified).success)
    throw denial('Verified LOC identity required',401);
  const permissions=await loadMcpLocAccess(null,verified);
  return {email:verified,roles:permissions.roles.map(({id,role})=>({id,role})),
    permissions};
}

// Verification remains signed-token + UserInfo. JS rights are only evaluated
// after the email and subject have been verified by LOC Auth.
export async function authorizeMcpBearer(token,subject,{
  fetchImpl=globalThis.fetch
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
  const parsed=VerifiedLocUserInfoSchema.safeParse(
    await response.json().catch(()=>null));
  if(!parsed.success||parsed.data.sub!==subject)
    throw denial('Verified LOC OAuth identity required',401);
  return authorizeMcpRole(parsed.data.email);
}
