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

test('Scope and Keywords cutover uses native Kysely services rather than SQL RPCs',()=>{
  const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
  const backend=read('supabase/functions/loc-kysely/index.ts');
  const anchor=read('app/loc/providers/kysely-anchor.mjs');
  const analytics=read('app/loc/providers/kysely-analytics.mjs');
  const management=read('app/loc/providers/kysely-management.mjs');
  const contract=read('app/loc/db-contract.mjs');
  const trace=read('app/modular/features/trace/TracePlaceResults.jsx');
  const keywords=read('app/loc/keyword-discovery-cache.mjs');
  const points=read('app/loc/PlaceBatchFill.jsx');
  assert.match(backend,/executeKyselyAnchor/);
  assert.match(backend,/executeKyselyAnalytics/);
  assert.match(backend,/executeManagedKyselyAction/);
  assert.match(anchor,/executeKyselyAnchor/);
  assert.match(analytics,/executeKyselyAnalytics/);
  assert.match(management,/importSharedKeywordClass/);
  assert.match(management,/mergeScopePoints/);
  assert.match(keywords,/\.anchor\(scopeId,'item',\{op:'suggestions'\}\)/);
  assert.match(points,/\.anchor\(scopeId,'point',\{op:'suggestions',limit:60\}\)/);
  assert.ok(contract.includes("analytics({"));
  assert.match(trace,/\.analytics\(/);
  for(const legacy of ['read_scope_analytics','scope_type_attr','import_shared_keyword_class']){
    assert.doesNotMatch(contract,new RegExp("\\.rpc\\('"+legacy+"'"));
  }
  const isr=read('app/api/loc/scopes/[scopeId]/numeric/[kind]/route.js');
  const local=read('app/loc/providers/local-sqlite.mjs');
  assert.match(isr,/name='read_scope_analytics'/);
  assert.match(local,/case 'read_scope_analytics'/);
  const sql=read('supabase/migrations/20261103173000_scope_suggestions_consolidation.sql');
  assert.match(sql,/DROP FUNCTION silver.read_scope_keyword_suggestions\(text\) RESTRICT/);
  assert.match(sql,/DROP FUNCTION silver.trace_place_suggestions\(text,integer\) RESTRICT/);
});
test('retired pre-Anchor Trace helpers cannot be reintroduced as independent RPCs',()=>{
  const migration=readFileSync(new URL('../supabase/migrations/20261103183000_retire_pre_anchor_trace_utilities.sql',import.meta.url),'utf8');
  for(const [name,signature] of [
    ['trace_normalize_place_name','text'],
    ['trace_prevent_identity_change',''],
    ['validate_scoped_trace_map','']
  ]){
    assert.ok(migration.includes('DROP FUNCTION silver.'+name+'('+signature+') RESTRICT;'),
      'Expected dependency-safe retirement of '+name);
  }
  assert.doesNotMatch(migration,/\bCASCADE\b/);
  assert.match(migration,/domain_has_repeated_labels/);
});
