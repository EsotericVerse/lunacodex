import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {FIXED_MANAGE_ROWS,fixedManageScope} from
  '../app/loc/permissions/fixed-manage-registry.mjs';
import {publishedManagedScope} from
  '../app/loc/providers/published-managed-scope.mjs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('fixed JS Manage catalog mirrors four public records without unused cache fields',()=>{
  assert.deepEqual(FIXED_MANAGE_ROWS.map(row=>row.id),
    ['admin','loc','lo3rwang','lrunes']);
  for(const row of FIXED_MANAGE_ROWS){
    assert.equal(row.email,'sopa2306@gmail.com');
    assert.equal(row.galaxy_table,'galaxy');
    assert.equal(row.anchor_table,'anchor');
    assert.equal(Object.hasOwn(row,'caches'),false);
    assert.equal(Object.hasOwn(row,'note'),false);
    assert.equal(fixedManageScope(row.id),row);
  }
  assert.equal(fixedManageScope('external'),null);
  assert.equal(fixedManageScope('__proto__'),null);
  assert.equal(fixedManageScope('admin').active,false);
});

test('built-in publication and JS Manage registry agree on routing and role',()=>{
  assert.equal(publishedManagedScope('admin'),null);
  for(const id of ['loc','lo3rwang','lrunes']){
    const row=publishedManagedScope(id);
    assert.equal(row.id,id);
    assert.equal(row.active,true);
    assert.equal(row, fixedManageScope(id));
  }
  assert.equal(publishedManagedScope('external'),null);
});

test('fixed registry removes SQL mapping probes but not signed authorization checks',()=>{
  const code=read('app/loc/providers/kysely-management.mjs');
  assert.match(code,/return publishedManagedScope\(scope\);/);
  assert.doesNotMatch(code,/selectFrom\('api\.manage'\)/);
  assert.match(code,/const record=await registeredScope\(trx,scope\);/);
  assert.match(code,/canLocAccess\(trx,'scope',scope\)/);
  const roles=read('app/loc/permissions/loc_access.mjs');
  assert.doesNotMatch(roles,/selectFrom\('api\.manage'\)/);
  assert.match(roles,/publishedLocAccess\(email,\{website\}\)/);
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
