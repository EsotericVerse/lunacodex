// Server-safe projection of LOC's explicitly published Scope routing.
// Only the stable physical table mapping comes from this JS snapshot.
// User authorization is independently verified against the signed identity.
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

// Standard published scopes never look up api.manage for their table names.
// Unlisted custom scopes retain the existing transaction-bound SQL fallback.
export function publishedManagedScope(scope){
  if(!ID.test(String(scope||'')))return null;
  const route=ROUTES.get(scope),publication=PUBLISHED.get(scope);
  if(!route&&!publication)return null;
  if(!route||!publication||
    route.active!==true||publication.active!==true||
    route.config?.id!==scope||
    !['scope','group'].includes(publication.scope_kind)||
    (publication.scope_kind==='scope'&&!route.directory&&!route.domain))
    throw inconsistent();
  const config=route.config||{};
  if(Object.hasOwn(config,'galaxy_table')||Object.hasOwn(config,'anchor_table'))
    throw inconsistent();
  return Object.freeze({
    id:scope,manage_role:publication.scope_kind,active:true,
    galaxy_table:'galaxy',anchor_table:'anchor'
  });
}
