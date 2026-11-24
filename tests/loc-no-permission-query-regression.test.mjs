import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('no standalone permission or Scope status HTTP operations survive',()=>{
  const native=read('app/loc/mcp/native-operations.mjs');
  const managed=read('app/loc/providers/kysely-management.mjs');
  assert.doesNotMatch(managed,/selectFrom\('api\.manage'\)/);
});

test('Manage changes cannot commit a role or route different from published JS',()=>{
  const native=read('app/loc/mcp/native-operations.mjs');
  assert.match(native,/requirePublishedManageWrite\(body\.payload\)/);
  assert.match(native,/for\(const item of body\.operations\)\{/);
  assert.match(native,/requirePublishedManageWrite\(item\)/);
  assert.match(native,/Object\.is\(fixed\[field\],value\)/);
  const lifecycle=read('app/loc/providers/kysely-scope-lifecycle.mjs');
  assert.match(lifecycle,/fixedManageScope\(id\)\?\.active===true/);
});

test('Statistics and public Search use published Scope JS, never api.manage SQL',()=>{
  const analytics=read('app/loc/providers/kysely-analytics.mjs');
  assert.doesNotMatch(analytics,/selectFrom\('api\.manage'\)|zmodelRegistryJoin/);
  assert.match(analytics,/publishedManagedScope\(scope\)/);
  assert.match(analytics,/FIXED_MANAGE_ROWS\.filter/);
});

test('Registry writes cannot silently outrun the published JS route',()=>{
  const lifecycle=read('app/loc/providers/kysely-scope-lifecycle.mjs');
  assert.match(lifecycle,/Publish matching JS Scope routing before Registry update/);
});
