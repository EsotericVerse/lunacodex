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

test('current website uses direct Kysely instead of retired read RPCs',()=>{
  const numeric=read('app/api/loc/_numeric-failover.mjs');
  assert.match(numeric,/await db\.analytics\(args\)/);
  assert.match(numeric,/await client\.publicAction\('read_app_bootstrap'/);
  assert.doesNotMatch(numeric,/\.rpc\s*\(/);
  const galaxy=read('app/loc/galaxy-query.js');
  const contract=read('app/loc/db-contract.mjs');
  for(const src of [galaxy,contract])
    assert.doesNotMatch(src,/read_scope_analytics|\.rpc\s*\(/);
  const gateway=read('supabase/functions/loc-kysely/index.ts');
  assert.match(gateway,/executeKyselyAnalytics/);
  assert.match(gateway,/executeKyselyPublicAction/);
  assert.doesNotMatch(gateway,/\bselect\s+silver\.read_scope_analytics\b/i);
});
