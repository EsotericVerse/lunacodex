// LOC Auth establishes identity; fixed JS Manage rows supply all business
// grants. Never issue a role lookup SQL query or a separate permission HTTP
// request. The caller must authenticate before using these results for writes.
import {locRolePrincipal,LOC_ROLE_LEVEL} from '../../../packages/zenstack/role-hierarchy.mjs';
import {loc_access,publishedLocAccess,LOC_OWNER_EMAIL} from './loc-business-grants.mjs';
export {loc_access,publishedLocAccess,LOC_OWNER_EMAIL} from './loc-business-grants.mjs';

const SCOPE=/^[a-z][a-z0-9]{0,14}$/;

// Preserve the existing call signature for request handlers. The DB argument
// is intentionally ignored: neither DB state nor an unpublished Registry row
// may override the fixed JavaScript grants.
export async function readLocAccess(_db,email,{website=false}={}){
  return publishedLocAccess(email,{website});
}

// Existing trusted Gateway grants are projected into the SAME ZModel
// LocPrincipal role hierarchy. Only LOC's root Group is the unified LOC
// administrator; other Group/Scope grants still require their exact resource.
export function hasLocAccess(claims,type,id=''){
  const kind=String(type||'').toLowerCase();
  const scope=String(id||'').toLowerCase();
  if(!['global','group','scope'].includes(kind)||
      kind!=='global'&&!SCOPE.test(scope))return false;
  const principal=locRolePrincipal(claims);
  if(!principal)return false;
  if(principal.roleLevel>=LOC_ROLE_LEVEL.admin)return true;
  if(kind==='global')return false;
  return kind==='group'?principal.groupIds.includes(scope):
    principal.groupIds.includes(scope)||principal.scopeIds.includes(scope);
}
