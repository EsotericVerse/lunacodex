import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {readonlyAuthStatus,recoveryOAuthLabel} from '../app/loc/providers/auth-status-readonly.mjs';

test('LOC SQL authorization is independent of the upstream identity provider',()=>{
  const current=readonlyAuthStatus();
  assert.equal(current.authorization,'LOC Authority');
  assert.equal(current.databaseAuthRequired,false);
  assert.match(current.primaryOAuth,/Clerk/);
  assert.match(current.primaryOAuth,/尚未啟用/);
});
test('public Clerk environment is displayed without a second recovery login',()=>{
  assert.equal(recoveryOAuthLabel({}), '未設定');
  assert.equal(recoveryOAuthLabel({publishableKey:'pk_test_abc',
    frontendApiUrl:'https://example.clerk.accounts.dev'}),'Clerk（Development）');
  assert.equal(recoveryOAuthLabel({publishableKey:'pk_live_abc',
    frontendApiUrl:'https://accounts.example.org'}),'Clerk（Production）');
});

test('Admin database panel shows real LOC Authority boundary, not vendor Auth toggles',()=>{
  const panel=readFileSync(new URL('../app/loc/views/admin-panels/DatabaseTarget.jsx',import.meta.url),'utf8');
  assert.match(panel,/身分來源與 LOC 授權（唯讀）/);
  assert.match(panel,/authOverview\.authorization/);
  assert.doesNotMatch(panel,/Supabase Auth：|Neon Auth|preferredDatabasePrimary|NEON_AUTH_URL/);
  assert.match(panel,/recoveryOAuth/);
  assert.match(panel,/FILE_URL/);
  assert.match(panel,/DATABASE_ACCESS_LIST/);
  assert.doesNotMatch(panel,/onChange|controlToken|connectionUrl|loc_admin_settings/);
});
