import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('legacy SQL Scope lifecycle is retired in favor of Kysely',()=>{
  const sql=readFileSync(new URL('../supabase/migrations/20261106120000_retire_legacy_api_scope_lifecycle.sql',import.meta.url),'utf8');
  const provider=readFileSync(new URL('../app/loc/providers/kysely-scope-admin.mjs',import.meta.url),'utf8');
  assert.match(sql,/DROP FUNCTION IF EXISTS api\.delete_scope\(text\) RESTRICT;/);
  assert.match(sql,/DROP FUNCTION IF EXISTS api\.provision_scope\(text,text,text,date,text,text,text,text,boolean\) RESTRICT;/);
  assert.doesNotMatch(sql,/\bCASCADE\b\s*;/i);
  assert.match(provider,/async function deleteScope\(/);
  assert.match(provider,/async function provisionScope\(/);
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
  assert.match(local,/analytics\(args\)\{return localAnalytics\(args\);\}/);
  assert.doesNotMatch(local,/\.rpc\(/);
  const sql=read('supabase/migrations/20261103173000_scope_suggestions_consolidation.sql');
  assert.match(sql,/DROP FUNCTION silver.read_scope_keyword_suggestions\(text\) RESTRICT/);
  assert.match(sql,/DROP FUNCTION silver.trace_place_suggestions\(text,integer\) RESTRICT/);
});
test('legacy pre-Anchor Trace utilities remain absent from current migrations',()=>{
  const provider=readFileSync(new URL('../app/loc/providers/kysely-anchor.mjs',import.meta.url),'utf8');
  for(const retired of ['trace_normalize_place_name','trace_prevent_identity_change','validate_scoped_trace_map']){
    assert.ok(!provider.includes(retired),'Old SQL Trace helper must not return: '+retired);
  }
});
