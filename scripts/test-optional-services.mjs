import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {DATABASE_ROUTING_CONFIG,resolveDatabaseRouting} from '../app/loc/providers/routing-config.mjs';
import {normalizeIsrDomains} from '../app/loc/providers/isr-domains.mjs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

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

test('single database uses a Kysely alias without a SQL Gateway',()=>{
 const route=resolveDatabaseRouting({...DATABASE_ROUTING_CONFIG,backupId:null});
 assert.equal(route.provider,'custom');
 assert.equal(route.backupId,null);
 assert.equal(route.verified,true);
 const configured=read('app/loc/providers/configured.mjs');
 assert.ok(!configured.includes('createLocGatewayAdapter'));
});
