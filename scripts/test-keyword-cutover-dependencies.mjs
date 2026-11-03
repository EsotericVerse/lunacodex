import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('six-column migration preserves Scope delete and music tree readers',()=>{
  const sql=readFileSync(new URL('../supabase/migrations/20261029226200_keyword_legacy_catalog_cleanup.sql',import.meta.url),'utf8');
  assert.match(sql,/CREATE OR REPLACE FUNCTION api\.delete_scope\(p_scope_id text\)/);
  assert.match(sql,/CREATE OR REPLACE FUNCTION silver\.read_music_style_tree\(\)/);
  assert.match(sql,/jsonb_array_elements_text\(c\.lists\)/);
  assert.match(sql,/jsonb_array_elements_text\(g\.lists\)/);
  assert.match(sql,/DROP TABLE IF EXISTS silver\.keyword_classes;/);
  assert.doesNotMatch(sql,/DELETE FROM silver\.keyword_classes/);
  assert.doesNotMatch(sql,/\bCASCADE\b\s*;/i);
});

test('portable Postgres/Kysely RPC allowlist follows the six-column cutover',()=>{
  const code=readFileSync(new URL('../app/loc/providers/kysely-runtime.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(code,/'silver\.read_keyword_tree_catalog':\[/);
  assert.doesNotMatch(code,/'silver\.read_keyword_tree_summary':\[/);
  assert.doesNotMatch(code,/'silver\.read_trace_keyword_group_totals':\[/);
  assert.doesNotMatch(code,/'silver\.read_music_style_tree':\[\]/);
  const migration=readFileSync(new URL('../supabase/migrations/20261103173000_scope_suggestions_consolidation.sql',import.meta.url),'utf8');
  assert.match(migration,/DROP FUNCTION silver\.read_music_style_tree\(\) RESTRICT/);
  assert.match(migration,/DROP FUNCTION silver\.trace_place_suggestions\(text,integer\) RESTRICT/);
  assert.match(migration,/DROP FUNCTION silver\.read_scope_keyword_suggestions\(text\) RESTRICT/);
  assert.ok(code.includes("'silver.read_scope_analytics':['p_scope_id','p_view','p_start','p_end','p_options']"));
  for(const name of [
    'apply_keyword_classification','read_keyword_class_by_uid',
    'read_keyword_uidlist_summary','read_keyword_item_catalog',
    'copy_rune66_keyword_class'
  ])assert.doesNotMatch(code,new RegExp("'silver\."+name+"'"));
});

test('unified Anchor operations retain only authorized transactional RPC gateways',()=>{
  const gateway=readFileSync(new URL('../app/loc/providers/kysely-runtime.mjs',import.meta.url),'utf8');
  const expected={
    import_shared_keyword_class:['p_target_scope','p_source_scope','p_class_uid'],
    save_scope_trace_place_names:['p_scope_id','p_uid','p_names'],
    preview_timeline_place_page_json:['p_scope_id','p_windows','p_limit','p_offset'],
    apply_scope_point_links:['p_scope_id','p_updates'],
    search_scope_trace_place_names:['p_scope_id','p_term','p_limit']
  };
  for(const [name,args] of Object.entries(expected)){
    assert.ok(gateway.includes("'silver."+name+"':["+args.map(a=>"'"+a+"'").join(',')+"]"),
      'Missing existing RPC gateway entry: '+name);
  }
  assert.equal(gateway.includes("'silver.merge_scope_trace_place_names':["),false);
  assert.ok(gateway.includes("const jsonbArgsByRpc={"));
  assert.ok(gateway.includes("'silver.preview_timeline_place_page_json':new Set(['p_windows'])"));
  assert.ok(gateway.includes("'silver.apply_scope_point_links':new Set(['p_updates'])"));
  assert.ok(gateway.includes("jsonbArgs?.has(name)"));
});

test('Culture, Keywords, Trace and ISR share one parameterized statistics RPC',()=>{
  const contract=readFileSync(new URL('../app/loc/db-contract.mjs',import.meta.url),'utf8');
  const trace=readFileSync(new URL('../app/modular/features/trace/TracePlaceResults.jsx',import.meta.url),'utf8');
  const isr=readFileSync(new URL('../app/api/loc/scopes/[scopeId]/numeric/[kind]/route.js',import.meta.url),'utf8');
  const local=readFileSync(new URL('../app/loc/providers/local-sqlite.mjs',import.meta.url),'utf8');
  assert.ok(contract.includes("rpc('read_scope_analytics'"));
  assert.ok(trace.includes("rpc('read_scope_analytics'"));
  assert.ok(isr.includes("name='read_scope_analytics'"));
  assert.ok(local.includes("case 'read_scope_analytics'"));
  for(const name of ['read_scope_category_totals','read_scope_statistics','read_scope_overview','read_scope_earliest','read_loc_statistics','read_keyword_tree_summary','read_keyword_tree_catalog'])
    assert.ok(!contract.includes("rpc('"+name+"'"),'Old domain RPC still used: '+name);
  assert.ok(!trace.includes("rpc('read_trace_place_density'"));
  assert.ok(!trace.includes("rpc('read_trace_keyword_group_totals'"));
});

test('owner-only Point and Item suggestions use one Scope type/attr entry',()=>{
  const code=readFileSync(new URL('../app/loc/providers/kysely-runtime.mjs',import.meta.url),'utf8');
  const keywords=readFileSync(new URL('../app/loc/keyword-discovery-cache.mjs',import.meta.url),'utf8');
  const points=readFileSync(new URL('../app/loc/PlaceBatchFill.jsx',import.meta.url),'utf8');
  const sql=readFileSync(new URL('../supabase/migrations/20261103173000_scope_suggestions_consolidation.sql',import.meta.url),'utf8');
  assert.match(keywords,/p_type:'item',p_attr:\{op:'suggestions'\}/);
  assert.match(points,/p_type:'point',p_attr:\{op:'suggestions',limit:60\}/);
  assert.doesNotMatch(keywords,/rpc\('read_scope_keyword_suggestions'/);
  assert.doesNotMatch(points,/rpc\('trace_place_suggestions'/);
  assert.doesNotMatch(code,/'silver.read_music_style_tree':\[\]/);
  assert.match(sql,/IF v_op='suggestions' THEN/);
  assert.match(sql,/IF NOT v_owner THEN/);
  assert.match(sql,/request.jwt.claim.sub/);
  assert.match(sql,/DROP FUNCTION silver.read_scope_keyword_suggestions\(text\) RESTRICT/);
  assert.match(sql,/DROP FUNCTION silver.trace_place_suggestions\(text,integer\) RESTRICT/);
});
