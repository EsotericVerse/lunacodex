import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const migration=read('supabase/migrations/20261106173000_retire_unused_read_business_rpcs.sql');

const dropNames=[
  'read_scope_analytics','read_loc_statistics','read_scope_overview',
  'read_keyword_tree_summary','read_trace_keyword_group_totals',
  'read_trace_place_density','read_scope_place_statistics',
  'read_scope_category_totals','read_scope_search_summary',
  'read_scope_statistics','read_scope_earliest',
  'read_shared_keyword_classes','scope_keyword_catalog',
  'read_scope_page_copy','read_app_bootstrap',
  'search_scope_trace_place_names'
];

test('drop exactly the sixteen replaced functions, with RESTRICT',()=>{
  const lines=migration.split('\n').map(v=>v.trim())
    .filter(v=>/^DROP FUNCTION/i.test(v));
  assert.equal(lines.length,dropNames.length);
  const actual=lines.map(line=>{
    const match=line.match(/^DROP FUNCTION IF EXISTS silver\.([a-z_]+)\(([^)]*)\) RESTRICT;$/);
    assert.ok(match,'Unsafe or malformed DROP: '+line);
    return match[1];
  });
  assert.deepEqual([...actual].sort(),[...dropNames].sort());
  assert.doesNotMatch(migration,/\bCASCADE\b(?![^\n]*prevents)/i);
  assert.doesNotMatch(migration,/\b(?:ALTER|CREATE|TRUNCATE|DELETE|UPDATE|INSERT)\s+(?:TABLE|INDEX|POLICY|TRIGGER)\b/i);
  for(const required of ['new_keyword_tree_uid','import_shared_keyword_class','manage','api.current_user_id'])
    assert.ok(!actual.includes(required),'Protected helper must remain: '+required);
});

const finalRetirement=read('supabase/migrations/20261106200000_retire_final_19_business_rpcs.sql');
const retiredBusinessFunctions=[
  'silver.manage_scope_registry','api.manage_scope_registry',
  'silver.management_write','api.management_write',
  'silver.import_shared_keyword_class','silver.keyword_class_is_shared',
  'silver.new_keyword_tree_uid','silver.batch_fill_galaxy_location',
  'silver.is_current_email_blocklisted','silver.loc_admin_settings',
  'silver.manage_id_not_blocked','silver.merge_scope_trace_place_names',
  'silver.preview_or_fill_galaxy_place','silver.read_group_members',
  'silver.read_scope_registry_admin','silver.refresh_scope_search_summary',
  'silver.save_scope_trace_place_names','silver.update_group_default_article_class',
  'silver.update_group_member_name'
];

test('retire exactly 19 Kysely-replaced business functions, no schema or access changes',()=>{
  const sql=finalRetirement.split('\n').map(line=>line.trim())
    .filter(line=>line.startsWith('DROP FUNCTION '));
  assert.equal(sql.length,19);
  const actual=sql.map(line=>{
    const match=line.match(/^DROP FUNCTION (silver|api)\.([a-z_]+)\(([^)]*)\) RESTRICT;$/);
    assert.ok(match,'Unsafe SQL retirement: '+line);
    return match[1]+'.'+match[2];
  });
  assert.deepEqual(actual.sort(),[...retiredBusinessFunctions].sort());
  assert.doesNotMatch(finalRetirement,/\bCASCADE\b|\bDROP\s+TABLE\b|\bALTER\s+TABLE\b/i);
  for(const kept of ['api.manage','api.current_user_id','api.request_claims',
      'silver.current_auth_email','silver.domain_has_repeated_labels',
      'silver.sync_scope_config_display_name','silver.touch_visual_novel_updated_at']){
    assert.ok(!actual.includes(kept),'Authorization or trigger helper must remain: '+kept);
  }
});

test('the deployed-source Kysely import does not call the old UID RPC',()=>{
  const management=read('app/loc/providers/kysely-management.mjs');
  const scopeAdmin=read('app/loc/providers/kysely-scope-admin.mjs');
  for(const source of [management,scopeAdmin]){
    assert.match(source,/allocateAnchorUid/);
    assert.doesNotMatch(source,/silver\.new_keyword_tree_uid\s*\(/);
  }
});
