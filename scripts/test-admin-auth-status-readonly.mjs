import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {readonlyAuthStatus} from '../app/loc/providers/auth-status-readonly.mjs';

test('native LOC Auth owns login, with independent SQL authorization',()=>{
  const current=readonlyAuthStatus();
  assert.equal(current.primaryOAuth,'LOC Auth（OAuth）');
  assert.equal(current.authorization,'LOC Authority');
  assert.equal(current.databaseAuthRequired,false);
});

test('Admin database panel shows runtime selection without legacy login fallback',()=>{
  const panel=readFileSync(new URL('../app/loc/views/admin-panels/DatabaseTarget.jsx',import.meta.url),'utf8');
  assert.match(panel,/身分來源與 LOC 授權（唯讀）/);
  assert.match(panel,/authOverview\.authorization/);
  assert.match(panel,/LOC Auth/);
  assert.match(panel,/DATABASE_ACCESS_LIST/);
  assert.doesNotMatch(panel,/recoveryOAuth|recovery\/config\.json/);
  assert.doesNotMatch(panel,/onChange|controlToken|connectionUrl|loc_admin_settings/);
});
