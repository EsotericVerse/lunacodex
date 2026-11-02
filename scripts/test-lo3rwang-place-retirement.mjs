import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('Point UI and RPCs use native Anchor.attr.location while other Scopes stay compatible',()=>{
  const ui=read('app/loc/TraceOrganizer.jsx');
  const sql=read('supabase/migrations/20261103005000_lo3rwang_point_aliases_in_anchor.sql');
  assert.match(ui,/const unified=scopeId==='lo3rwang'/);
  assert.match(ui,/unified\?'_anchor':'_place'/);
  assert.match(ui,/data\?\.attr\?\.location/);
  assert.match(sql,/save_scope_trace_place_names/);
  assert.match(sql,/search_scope_trace_place_names/);
  assert.match(sql,/merge_scope_trace_place_names/);
  assert.match(sql,/jsonb_set\(attr,'\{location\}'/);
  assert.match(sql,/UPDATE silver\.lo3rwang_galaxy SET place_id=p_keep_uid/);
  assert.match(sql,/a\.type IN \('path','trace'\)/);
});

test('old empty UID4 Place table is dropped only after Point RPCs are verified',()=>{
  const sql=read('supabase/migrations/20261103006000_drop_lo3rwang_place.sql');
  assert.match(sql,/count\(\*\) FROM silver\.lo3rwang_place/);
  assert.match(sql,/DROP TABLE silver\.lo3rwang_place RESTRICT/);
  assert.doesNotMatch(sql,/CASCADE/i);
});