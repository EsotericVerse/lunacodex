import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {DATABASE_ACCESS_LIST} from '../app/loc/providers/access.js';
import {DATABASE_ROUTING_CONFIG,resolveDatabaseRouting} from '../app/loc/providers/routing-config.mjs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('two database targets are read from access.js, not manage.database',()=>{
  assert.deepEqual(DATABASE_ACCESS_LIST.map(item=>item.target_id),
    ['supabase-current','neon-current']);
  assert.equal(DATABASE_ACCESS_LIST.filter(item=>item.selected).length,1);
  assert.equal(DATABASE_ACCESS_LIST.filter(item=>item.backup_selected).length,1);
  assert.equal(resolveDatabaseRouting(DATABASE_ROUTING_CONFIG).primaryId,'supabase-current');
  const gateway=read('supabase/functions/loc-kysely/index.ts');
  const panel=read('app/loc/views/admin-panels/DatabaseTarget.jsx');
  const manager=read('app/loc/providers/kysely-management.mjs');
  assert.match(gateway,/databaseAccessTargets\(\)/);
  assert.doesNotMatch(gateway,/selectFrom\("api.manage"\)\.select\("database"\)/);
  assert.doesNotMatch(gateway,/updateTable\("api.manage"\)\.set\(\{database/);
  assert.match(panel,/DATABASE_ACCESS_LIST/);
  assert.match(panel,/GitHub.*access\.js/);
  assert.doesNotMatch(panel,/p_section:'database'|connect_database_target/);
  assert.doesNotMatch(manager,/select\('database'\)|set\(\{\s*database:/);
  const migration=read('supabase/migrations/20261106111500_manage_database_js_access_cutover.sql');
  assert.match(migration,/ALTER TABLE silver\.manage DROP COLUMN IF EXISTS database/);
  assert.doesNotMatch(migration,/DROP\s+DATABASE|DROP\s+SCHEMA|ENABLE ROW LEVEL SECURITY|DISABLE ROW LEVEL SECURITY/i);
});
test('email and reserved scope management remain unchanged',()=>{
  const mail=read('app/loc/views/admin-panels/AdminEmailBlocklist.jsx'),
    scopes=read('app/loc/views/admin-panels/AdminReservedScopeIds.jsx');
  assert.match(mail,/p_section:'email'/);
  assert.match(scopes,/p_section:'scopeid'/);
  const gateway=read('supabase/functions/loc-kysely/index.ts');
  assert.match(gateway,/loc_admin_settings/);
});
