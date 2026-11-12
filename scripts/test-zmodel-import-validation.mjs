import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertZModelImportRows,importSchemaForSqlTable} from '../zenstack/import-validation.mjs';
import {createImportProgressStore} from '../app/loc/import-progress-store.mjs';
import {modelNameForSql,modelFieldsForSql} from '../zenstack/model-column-guard.mjs';

const record=Object.freeze({uid:'TEST0001',title:'匯入測試',content:'正常資料',
  createtime:'2026-11-12T00:00:00.000Z',site:'threads',date:'2026-11-12',
  target_id:null,media_link:null,statics:true,culture:true});

test('Zod derives one cached validator from the existing ZModel contract',()=>{
  assert.equal(modelNameForSql('silver','lo3rwang_galaxy'),'Lo3rwangGalaxy');
  assert.equal(modelNameForSql('silver','demo_galaxy'),'Lo3rwangGalaxy');
  assert.equal(modelNameForSql('silver','lrunes_galaxy'),'LrunesGalaxy');
  assert.ok(modelFieldsForSql('silver','demo_galaxy').uid);
  assert.equal(importSchemaForSqlTable('silver.demo_galaxy'),
    importSchemaForSqlTable('silver.lo3rwang_galaxy'));
});

test('one modeled import check preserves valid native DATE and nullable arrays',()=>{
  const rows=[{...record},{...record,uid:'TEST0002',date:null,
    target_id:['ABCD1234'],media_link:['MEDIA001']}];
  assert.equal(assertZModelImportRows('silver.demo_galaxy',rows),rows);
  assert.equal(assertZModelImportRows('silver.lrunes_galaxy',rows),rows);
});

test('unknown keys and malformed typed fields cannot enter the write batch',()=>{
  assert.throws(()=>assertZModelImportRows('silver.demo_galaxy',
    [{...record,createtime:'not-an-iso-date'}]),/createtime/);
  assert.throws(()=>assertZModelImportRows('silver.demo_galaxy',
    [{...record,statics:'false'}]),/statics/);
  assert.throws(()=>assertZModelImportRows('silver.demo_galaxy',
    [{...record,unexpected_field:42}]),/unexpected_field/);
  assert.throws(()=>assertZModelImportRows('silver.demo_galaxy',
    [{...record,target_id:[123]}]),/target_id/);
});

test('unknown physical tables never create a dynamic validation authority',()=>{
  assert.throws(()=>importSchemaForSqlTable('silver.custom_fake'),/No LOC import ZModel/);
  assert.throws(()=>assertZModelImportRows('api.manage',[]),/Invalid LOC Galaxy import table/);
});

test('useSyncExternalStore snapshot is stable, local, and event-driven',()=>{
  const store=createImportProgressStore(),other=createImportProgressStore();
  let notices=0;
  const unsubscribe=store.subscribe(()=>notices++);
  assert.equal(store.getServerSnapshot(),null);
  assert.equal(store.getSnapshot(),null);
  store.set({stage:'validated',completed:1,total:2});
  assert.equal(notices,1);
  assert.equal(store.getSnapshot().stage,'validated');
  store.set(old=>({...old,completed:2}));
  assert.equal(store.getSnapshot().completed,2);
  assert.equal(notices,2);
  assert.equal(other.getSnapshot(),null);
  unsubscribe();
  store.set(null);
  assert.equal(notices,2);
});

test('only import insert path uses ZModel check; editor and query stay untouched',()=>{
  const client=readFileSync(new URL('../app/loc/db-contract.mjs',import.meta.url),'utf8');
  const panel=readFileSync(new URL('../app/loc/ManagementImportPanel.jsx',import.meta.url),'utf8');
  assert.match(client,/const insertImportRows=async\(table,rows\)=>/);
  assert.match(client,/assertZModelImportRows\(table,prepareGalaxyInsertRows\(table,rows\)\)/);
  assert.match(client,/return insertRowsUnchecked\(table,rows\)/);
  assert.match(panel,/useSyncExternalStore\(progressStore.subscribe/);
  assert.doesNotMatch(panel,/from 'tanstack|from 'swr/);
});
