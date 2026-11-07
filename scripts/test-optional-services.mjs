import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {DATABASE_ROUTING_CONFIG,resolveDatabaseRouting} from '../app/loc/providers/routing-config.mjs';
import {normalizeIsrDomains} from '../app/loc/providers/isr-domains.mjs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('single-database installs have no mandatory backup SQL Gateway',()=>{
  const route=resolveDatabaseRouting({...DATABASE_ROUTING_CONFIG,backupId:null});
  assert.equal(route.backupId,null);
  assert.equal(route.verified,true);
  const server=read('app/api/loc/_server.js');
  assert.match(server,/const candidates=\[\{id:'primary'/);
  assert.match(server,/if\(backupGatewayUrl\)/);
  assert.doesNotMatch(server,/NEON_AUTH_URL|PostgrestClient|createBackupPublicAdapter/);
});

test('configured backup requires an independent Kysely Gateway, not Neon Auth',()=>{
  const source=read('app/api/loc/_server.js');
  assert.match(source,/LOC_BACKUP_SQL_GATEWAY_URL/);
  assert.match(source,/gatewayUrl:backupGatewayUrl/);
  assert.match(source,/id:'backup'/);
  assert.match(source,/createKyselyEdgeClient/);
  assert.match(read('app/loc/providers/routing-config.mjs'),/DATABASE_ACCESS_LIST/);
  assert.match(read('app/loc/providers/access.js'),/backup_selected:true/);
});

test('zero remote ISR services is supported on a fresh installation',()=>{
  assert.deepEqual(normalizeIsrDomains([]),[]);
  const source=read('app/loc/cache-policy.config.mjs');
  assert.match(source,/domains:\[\]/);
  const panel=read('app/loc/views/admin-panels/IsrDomainTarget.jsx');
  assert.match(panel,/value="cache">Service Worker/);
  assert.match(panel,/value="off">No Cache/);
  assert.match(panel,/ISR 完全選配/);
  const migration=read('supabase/migrations/20261028220000_loc_runtime_config.sql');
  assert.match(migration,/values \('loc','cache','','\[\]'::jsonb/);
});

test('backup readiness check is only invoked in Admin settings',()=>{
  const server=read('app/loc/gateway/sql-handler.ts');
  const panel=read('app/loc/views/admin-panels/DatabaseTarget.jsx');
  assert.match(server,/check_backup_readiness/);
  assert.match(server,/\.filter\(item=>item\.backup_selected===true\)/);
  assert.match(server,/backup\.introspection\.getTables\(\)/);
  assert.match(panel,/check_backup_readiness/);
  assert.match(panel,/backupHealth\.state==='absent'/);
});

test('configured ISR requires a capability handshake rather than a domain alone',()=>{
  const endpoint=read('app/api/loc/isr-capabilities/route.js');
  const panel=read('app/loc/views/admin-panels/IsrDomainTarget.jsx');
  assert.match(endpoint,/numericHttpCache:true/);
  assert.match(panel,/checkIsrCapability\(selected\.origin\)/);
  assert.match(panel,/checkDomains\(next\.domains/);
  assert.match(panel,/未確認支援/);
});

test('primary failure with no backup cannot be reported as an active backup',()=>{
  const status=read('app/loc/db-source-status.mjs');
  assert.match(status,/!hasBackup&&failingResources/);
  assert.match(status,/backupLabel:String\(backupLabel\?\?''\)/);
  const app=read('app/AppShell.jsx');
  assert.match(app,/backupLabel\|\|'未設定（選配）'/);
});
