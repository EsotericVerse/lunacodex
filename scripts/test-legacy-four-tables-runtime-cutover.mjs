import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');

test('spatial references use Anchor point fields, not retired trace tables',()=>{
  const source=read('app/modular/features/trace/trace-spatial-reference-data.js');
  assert.doesNotMatch(source,/from\(scope\+'_trace'\)|trace_type|space_anchor/);
  assert.match(source,/\.from\(scope\+'_anchor'\)/);
  assert.match(source,/\.eq\('type','point'\)/);
  assert.match(source,/\.select\('uid,title,attr'\)/);
  assert.match(source,/row\.attr\?\.longitude/);
  assert.match(source,/row\.attr\?\.latitude/);
});

test('place summary lists point Anchors, not legacy _trace',()=>{
  const source=read('app/loc/place-summary-client.js');
  assert.doesNotMatch(source,/scopeId\+'_trace'|trace_type|space_anchor/);
  assert.match(source,/selectRows\(scope\.anchor,/);
  assert.match(source,/\{column:'type',operator:'eq',value:'point'\}/);
});

test('legacy diagnostic counter and Trace short sequences are explicitly retired',()=>{
  const sql=read('supabase/migrations/20261106235000_retire_legacy_trace_sequences_and_permission_counter.sql');
  assert.match(sql,/DROP FUNCTION IF EXISTS silver\.record_permission_check\(text\)/);
  for(const scope of ['lo3rwang','loc','lrunes']){
    assert.ok(sql.includes('DROP SEQUENCE IF EXISTS silver.'+scope+'_trace_short_seq RESTRICT'));
  }
  assert.doesNotMatch(sql,/\bCASCADE\b/i);
});
