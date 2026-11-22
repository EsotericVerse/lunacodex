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
  assert.match(code,/const fixed=publishedManagedScope\(scope\);/);
  assert.match(code,/if\(fixed\)return fixed;/);
  assert.match(code,/const record=await registeredScope\(trx,scope\);/);
  assert.match(code,/canLocAccess\(trx,'scope',scope\)/);
  const roles=read('app/loc/permissions/loc_access.mjs');
  assert.match(roles,/db\.selectFrom\('api\.manage'\)/);
});

test('empty cache-backed admin setting is retired; fixed transfer ceilings remain',()=>{
  const code=read('app/loc/providers/kysely-management.mjs');
  assert.doesNotMatch(code,/\.select\('caches'\)/);
  assert.doesNotMatch(code,/section==='runtime'/);
  const constants=read('app/loc/query/query-batch-size.mjs');
  assert.match(constants,/archiveMiB:1024,jsonMiB:50,documentMiB:128,timelineMiB:200/);
  assert.doesNotMatch(constants,/encodeRuntimeIo|decodeRuntimeIo|normalizeReservedIsr/);
  const view=read('app/loc/views/AdminHomeView.jsx');
  assert.doesNotMatch(view,/RuntimeIoSettings|value:'io'/);
});
