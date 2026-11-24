// Read action names are denylisted from the write dispatcher. Each feature
// exports and calls its own Next Server Action instead.
const FEATURE_READ_ACTIONS=new Set([
  'read_group_members','read_loc_source_hierarchy','read_scope_registry_admin',
  'find_galaxy_duplicates','keyword_pattern_statistics',
  'suggest_search_patterns','search_galaxy_private',
  'preview_galaxy_place_fill','preview_galaxy_location_batch',
  'preview_galaxy_visibility',
  'media_anchor_candidates','anchor_import_page','import_site_presence',
  'import_site_id_candidates','import_created_at_candidates',
  'import_occupied_createtimes'
]);
const MANAGED_WRITE_ACTIONS=new Set([
  'update_group_member_name','move_scope_block','save_blocks',
  'fill_galaxy_place','apply_galaxy_location_batch',
  'apply_galaxy_visibility_flags',
  'rename_scope_site_batch','save_scope_trace_place_names',
  'refresh_scope_search_summary',
  'merge_scope_trace_place_names','import_shared_keyword_class',
  'provision_scope','manage_scope_registry','delete_scope',
  'save_scope_trace_edit'
]);
const WRITE_ARGUMENTS=Object.freeze({
  update_group_member_name:['p_group_id','p_member_id','p_display_name'],
  move_scope_block:['p_scope_id','p_page_name','p_uid','p_direction'],
  save_blocks:['p_scope_id','p_type','p_rows'],
  fill_galaxy_place:['p_scope_id','p_start_date','p_end_date','p_place','p_expected_count'],
  apply_galaxy_location_batch:['p_scope_id','p_uids','p_place','p_expected_count'],
  apply_galaxy_visibility_flags:['p_scope_id','p_site','p_flags','p_expected_count','p_batch_size'],
  rename_scope_site_batch:['p_scope_id','p_before','p_after','p_batch_size'],
  save_scope_trace_place_names:['p_scope_id','p_uid','p_names'],
  loc_admin_settings:['p_section','p_operation','p_key','p_value'],
  refresh_scope_search_summary:['p_scope_id'],
  merge_scope_trace_place_names:['p_scope_id','p_keep_uid','p_remove_uids'],
  import_shared_keyword_class:['p_target_scope','p_source_scope','p_class_uid'],
  provision_scope:['p_scope_id','p_display_name','p_email','p_birthday',
    'p_domain','p_directory','p_parent_scope_id','p_theme','p_locale','p_copy_keywords'],
  manage_scope_registry:['p_operation','p_scope_id','p_values'],
  delete_scope:['p_scope_id'],
  save_scope_trace_edit:['p_scope_id','p_renames','p_point','p_keep_uid',
    'p_merge_uids','p_visibility']
});

export function isManagedReadAction(name,args={}){
  return FEATURE_READ_ACTIONS.has(String(name||''))||
    name==='loc_admin_settings'&&args?.p_operation==='read';
}

export function isManagedWriteAction(name,args={}){
  const action=String(name||'');
  if(!MANAGED_WRITE_ACTIONS.has(action)||!args||
    typeof args!=='object'||Array.isArray(args))return false;
  const allowed=WRITE_ARGUMENTS[action];
  if(!allowed||Object.keys(args).some(key=>!allowed.includes(key)))return false;
  if(action==='loc_admin_settings'&&
    !['upsert','delete'].includes(String(args.p_operation||'')))return false;
  return true;
}
