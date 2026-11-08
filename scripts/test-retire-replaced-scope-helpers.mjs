import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('replaced legacy Scope helper SQL functions retire safely',()=>{
  const migration=source('supabase/migrations/20261106150000_retire_replaced_scope_helper_rpcs.sql');
  for(const signature of [
    'silver.find_galaxy_duplicates(text)',
    'silver.rename_scope_site_batch(text,text,text,integer)',
    'silver.save_archive_media_exif(text,jsonb)'
  ])assert.ok(migration.includes('DROP FUNCTION IF EXISTS '+signature+' RESTRICT;'));
  assert.match(migration,/FROM pg_depend/);
  assert.doesNotMatch(migration,/\b(?:DROP TABLE|TRUNCATE|DELETE FROM|CASCADE)\b/i);
});

