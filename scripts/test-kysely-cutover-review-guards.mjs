import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('Galaxy validity trigger uses SQL COALESCE syntax and eight flags',()=>{
  const migration=source('supabase/migrations/20261104120000_remove_galaxy_able.sql');
  assert.match(migration,/coalesce\(NEW\.site,''\)/i);
  assert.doesNotMatch(migration,/pg_catalog\.coalesce\s*\(/i);
  assert.match(migration,/drop column able restrict/i);
  assert.match(migration,/NEW\.search:=false/);
  assert.match(migration,/NEW\.list:=false/);
});

test('Kysely Scope provisioning accepts prefixed route arguments',()=>{
  const admin=source('app/loc/providers/kysely-scope-admin.mjs');
  assert.match(admin,/route\(\{domain:args\.p_domain,directory:args\.p_directory\}\)/);
  assert.match(admin,/const DOMAIN=/);
  assert.match(admin,/const DIR=/);
  assert.match(admin,/const can=sql\x60coalesce\(/);
});

test('LOC blacklist updates bind SQL text[] paths, never JSON array strings',()=>{
  const management=source('app/loc/providers/kysely-management.mjs');
  assert.match(management,/jsonb_set\(blacklist,ARRAY\[\$\{section\}\]::text\[\]/);
  assert.doesNotMatch(management,/JSON\.stringify\(\[section\]\)\}::text\[\]/);
});

