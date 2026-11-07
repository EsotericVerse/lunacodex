import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {DATABASE_ACCESS_LIST} from '../app/loc/providers/access.js';
import {DATABASE_ROUTING_CONFIG,resolveDatabaseRouting} from '../app/loc/providers/routing-config.mjs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('one portable default control Alias, with per-user runtime database selection',()=>{
  assert.deepEqual(DATABASE_ACCESS_LIST.map(item=>item.target_id),['loc-main']);
  assert.equal(DATABASE_ACCESS_LIST.filter(item=>item.selected).length,1);
  assert.equal(DATABASE_ACCESS_LIST.filter(item=>item.backup_selected).length,0);
  const route=resolveDatabaseRouting(DATABASE_ROUTING_CONFIG);
  assert.equal(route.primaryId,'loc-main');
  assert.equal(route.provider,'custom');
  assert.equal(route.connectionAlias,'loc_main');
  const gateway=read('app/loc/gateway/sql-handler.ts');
  const panel=read('app/loc/views/admin-panels/DatabaseTarget.jsx');
  const manager=read('app/loc/providers/kysely-management.mjs');
  assert.match(gateway,/databaseAccessTargets\(\)/);
  assert.doesNotMatch(gateway,/selectFrom\("api.manage"\)\.select\("database"\)/);
  assert.doesNotMatch(gateway,/updateTable\("api.manage"\)\.set\(\{database/);
  assert.match(panel,/DATABASE_ACCESS_LIST/);
  assert.match(panel,/無需重新部署/);
  assert.doesNotMatch(panel,/p_section:'database'|connect_database_target/);
  assert.doesNotMatch(manager,/select\('database'\)|set\(\{\s*database:/);
});
test('email and reserved scope management remain unchanged',()=>{
  const mail=read('app/loc/views/admin-panels/AdminEmailBlocklist.jsx');
  const scopes=read('app/loc/views/admin-panels/AdminReservedScopeIds.jsx');
  assert.match(mail,/p_section:'email'/);
  assert.match(scopes,/p_section:'scopeid'/);
  assert.match(read('app/loc/gateway/sql-handler.ts'),/loc_admin_settings/);
});
