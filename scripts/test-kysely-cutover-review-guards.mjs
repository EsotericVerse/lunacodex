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

test('authenticated Kysely writes retain Clerk and LOC authority gates',()=>{
  const gateway=source('app/loc/gateway/sql-handler.ts');
  const management=source('app/loc/providers/kysely-management.mjs');
  assert.match(gateway,/role!==["']authenticated["']/);
  assert.match(management,/await authorizeRelation\(trx,table,operation,values,filters,rows\)/);
  assert.match(management,/await canManage\(trx,'scope',scope\)/);
});

test('Search, editing and MCP sync reference eight separate Galaxy booleans',()=>{
  const search=source('app/modular/features/Search.jsx');
  const draft=source('app/modular/features/search-edit-draft.js');
  const gateway=source('app/loc/gateway/sql-handler.ts');
  assert.match(search,/columns:'uid,content,search,extract'/);
  assert.doesNotMatch(search,/columns:'uid,content,able'/);
  assert.match(draft,/const features=\['statics','culture','search','trace','list','keyword','extract','others'\]/);
  assert.match(gateway,/const flags=\["statics","culture","search","trace","list","keyword","extract","others"\]/);
});

test('Kysely 0.29.8 is synchronized across package lock and all Edge imports',()=>{
  const manifest=JSON.parse(source('package.json'));
  const lock=JSON.parse(source('package-lock.json'));
  assert.equal(manifest.dependencies.kysely,'0.29.8');
  assert.equal(lock.packages[''].dependencies.kysely,'0.29.8');
  assert.equal(lock.packages['node_modules/kysely'].version,'0.29.8');
  assert.match(lock.packages['node_modules/kysely'].resolved,/\/kysely-0\.29\.8\.tgz$/);
  for(const path of [
    'app/loc/providers/kysely-runtime.mjs',
    'app/loc/providers/kysely-anchor.mjs',
    'app/loc/providers/kysely-analytics.mjs',
    'app/loc/providers/kysely-management.mjs',
    'app/loc/providers/kysely-public.mjs',
    'app/loc/providers/kysely-scope-admin.mjs',
    'app/loc/gateway/sql-handler.ts',
    'app/loc/providers/kysely-database-drivers.ts'
  ]){
    assert.match(source(path),/npm:kysely@0\.29\.8/,path);
    assert.doesNotMatch(source(path),/npm:kysely@0\.29\.6/,path);
  }
});
