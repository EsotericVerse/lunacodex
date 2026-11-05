import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('retired search keyword logging RPCs cannot resurrect old table or remove search QoS',()=>{
  const sql=readFileSync(new URL('../supabase/migrations/20261106140000_retire_broken_search_keyword_log_rpcs.sql',import.meta.url),'utf8');
  assert.match(sql,/DROP FUNCTION IF EXISTS silver\.log_search_keyword\(text,text\) RESTRICT;/);
  assert.match(sql,/DROP FUNCTION IF EXISTS api\.log_search_keyword\(text,text\) RESTRICT;/);
  assert.match(sql,/to_regclass\('silver\.loc_search_keywords'\)/);
  assert.doesNotMatch(sql,/\bCASCADE\b/i);
  assert.doesNotMatch(sql,/DROP TABLE|TRUNCATE|DELETE FROM/i);
  const search=readFileSync(new URL('../app/loc/galaxy-query.js',import.meta.url),'utf8');
  assert.match(search,/export async function searchGalaxyRows\(/);
  assert.match(search,/Fetch one extra row instead/);
});
