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

test('legacy pre-Anchor Trace utilities remain absent from current migrations',()=>{
  const provider=readFileSync(new URL('../app/loc/providers/kysely-anchor.mjs',import.meta.url),'utf8');
  for(const retired of ['trace_normalize_place_name','trace_prevent_identity_change','validate_scoped_trace_map']){
    assert.ok(!provider.includes(retired),'Old SQL Trace helper must not return: '+retired);
  }
});
