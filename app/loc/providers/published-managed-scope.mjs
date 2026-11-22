// Fixed api.manage Scope projection. All twelve columns are authored in
// fixed-manage-registry.mjs, including the public contact email and caches.
// The independently published routes must agree before a built-in table is
// accepted. Authorization still uses the verified LOC identity and grants.
import {fixedManageScope} from '../permissions/fixed-manage-registry.mjs';
import {SCOPE_ROUTE_INDEX} from '../../modular/routing/scope-route-index.js';
import {PUBLISHED_SITE_BOOTSTRAP} from '../../modular/published-site-bootstrap.js';

const ROUTES=new Map(SCOPE_ROUTE_INDEX.map(row=>[row.scope_id,row]));
const PUBLISHED=new Map((PUBLISHED_SITE_BOOTSTRAP.registry||[])
  .map(row=>[row.scope_id,row]));
const ID=/^[a-z][a-z0-9]{0,14}$/;
const inconsistent=()=>Object.assign(
  new Error('Published LOC Scope routing differs between JS snapshots'),
  {httpStatus:409}
);

export function publishedManagedScope(scope){
  if(!ID.test(String(scope||'')))return null;
  const fixed=fixedManageScope(scope);
  if(!fixed)return null;
  if(fixed.id==='admin')return null;
  const route=ROUTES.get(scope),publication=PUBLISHED.get(scope);
  if(!route||!publication||fixed.active!==true||
    route.active!==fixed.active||publication.active!==fixed.active||
    route.domain!==fixed.domain||route.directory!==fixed.directory||
    publication.domain!==fixed.domain||publication.directory!==fixed.directory||
    publication.parent_scope_id!==fixed.parent_scope_id||
    publication.sort_order!==fixed.sort_order||
    publication.scope_kind!==fixed.manage_role||
    route.config?.id!==scope||
    !['scope','group'].includes(fixed.manage_role))
    throw inconsistent();
  return fixed;
}
