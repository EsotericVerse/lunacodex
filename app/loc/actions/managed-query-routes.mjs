// Feature-specific Next.js routes for small protected reads. Import metadata
// remains on the bounded import operation because it is consumed in batches.
const routes=Object.freeze({
  read_group_members:'/api/loc-query/group',
  read_loc_source_hierarchy:'/api/loc-query/admin',
  read_scope_registry_admin:'/api/loc-query/admin',
  find_galaxy_duplicates:'/api/loc-query/galaxy',
  keyword_pattern_statistics:'/api/loc-query/keywords',
  suggest_search_patterns:'/api/loc-query/keywords',
  search_galaxy_private:'/api/loc-query/search'
});

export function managedQueryRoute(name,args={}){
  if(name==='loc_admin_settings'&&args?.p_operation==='read')
    return '/api/loc-query/keywords';
  return routes[String(name||'')]||'';
}

export const MANAGED_QUERY_ROUTE_ACTIONS=Object.freeze({
  admin:Object.freeze(['read_loc_source_hierarchy','read_scope_registry_admin']),
  group:Object.freeze(['read_group_members']),
  galaxy:Object.freeze(['find_galaxy_duplicates']),
  keywords:Object.freeze(['keyword_pattern_statistics','suggest_search_patterns','loc_admin_settings']),
  search:Object.freeze(['search_galaxy_private'])
});

export const MANAGED_IMPORT_READ_ACTIONS=Object.freeze([
  'media_anchor_candidates','anchor_import_page','import_site_presence',
  'import_site_id_candidates','import_created_at_candidates',
  'import_occupied_createtimes'
]);

export function isManagedReadAction(name,args={}){
  return Boolean(routes[String(name||'')])||
    name==='loc_admin_settings'&&args?.p_operation==='read'||
    MANAGED_IMPORT_READ_ACTIONS.includes(String(name||''));
}
