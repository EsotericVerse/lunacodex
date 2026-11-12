import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertZModelImportRows,importSchemaForSqlTable} from '../zenstack/import-validation.mjs';
import {createImportProgressStore} from '../app/loc/import-progress-store.mjs';
import {createDatabaseClient} from '../app/loc/db-contract.mjs';
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

test('modeled CHAR(8) identifiers reject padding and non-alphanumeric input',()=>{
  const references=['uid','source_id','ref_id','place_id'];
  for(const field of references){
    for(const bad of ['AB12','ABCD123!','ABCDEFGHI']){
      assert.throws(()=>assertZModelImportRows('silver.demo_galaxy',
        [{...record,[field]:bad}]),new RegExp(field));
    }
  }
  const valid={...record,source_id:'SOURCE01',ref_id:'REF00001',
    place_id:'PLACE001'};
  assert.equal(assertZModelImportRows('silver.demo_galaxy',[valid])[0],valid);
  assert.equal(assertZModelImportRows('silver.demo_galaxy',
    [{...record,source_id:null,ref_id:null,place_id:null}]).length,1);
});

test('existing Galaxy ZModel validation exposes bounded progress without extra SQL',()=>{
  const rows=Array.from({length:513},(_,index)=>({
    ...record,uid:'U'+String(index).padStart(7,'0')
  }));
  const progress=[];
  assert.equal(assertZModelImportRows('silver.lo3rwang_galaxy',rows,{
    onProgress:value=>progress.push(value)
  }),rows);
  assert.deepEqual(progress,[
    {completed:256,total:513},
    {completed:512,total:513},
    {completed:513,total:513}
  ]);
  assert.throws(()=>assertZModelImportRows('silver.lo3rwang_galaxy',
    [{...record,statics:'invalid'}],{
      onProgress:value=>progress.push(value)
    }),/statics/);
  assert.equal(progress.length,3,'rejected data must not emit success progress');
});

test('Galaxy import writes validated ZModel rows once and retains ordinary inserts',async()=>{
  const managed=[];
  const adapter={
    publicClient:{schema:()=>({})},
    authClient:{schema:()=>({
      managedWrite:async payload=>{
        managed.push(payload);
        return {data:{count:payload.p_rows.length},error:null};
      }
    })},
    auth:{
      getSession:()=>null,getUser:()=>null,
      signInWithOAuth:async()=>({error:null}),
      signOut:async()=>({error:null})
    }
  };
  const db=createDatabaseClient(adapter);
  const progress=[];
  const rows=[{...record}];
  const inserted=await db.insertImportRows('silver.lo3rwang_galaxy',rows,{
    onValidationProgress:value=>progress.push(value)
  });
  assert.equal(inserted.count,1);
  assert.deepEqual(progress,[{completed:1,total:1}]);
  assert.equal(managed.length,1,'one managed Kysely INSERT without retry');
  assert.equal(managed[0].p_operation,'insert');
  assert.equal(managed[0].p_rows[0].uid,record.uid);
  assert.equal(managed[0].p_rows[0].content,record.content);
  assert.equal(managed[0].p_rows[0].culture,true);
  assert.equal(Object.hasOwn(managed[0].p_rows[0],'able'),false);
  assert.equal(Object.hasOwn(rows[0],'able'),false,'input objects must not mutate');
  await assert.rejects(()=>db.insertImportRows('silver.lo3rwang_galaxy',
    [{...record,createtime:'not-an-iso-date'}]),/createtime/);
  assert.equal(managed.length,1,'invalid import must not reach managed SQL');
  await db.insertRows('silver.lo3rwang_galaxy',rows);
  assert.equal(managed.length,2,'ordinary insert route remains available');
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

test('import progress and server-side Galaxy validation share the ZModel write contract',()=>{
  const client=readFileSync(new URL('../app/loc/db-contract.mjs',import.meta.url),'utf8');
  const panel=readFileSync(new URL('../app/loc/ManagementImportPanel.jsx',import.meta.url),'utf8');
  assert.match(client,/const insertImportRows=async\(table,rows,\{onValidationProgress\}=\{\}\)=>/);
  assert.match(client,/const prepared=prepareGalaxyInsertRows\(table,rows\)/);
  assert.match(client,/return insertRowsUnchecked\(table,prepared,\{normalizedGalaxy:true\}\)/);
  assert.match(client,/assertZModelImportRows\(table,prepared,\{onProgress:onValidationProgress\}\)/);
  assert.match(client,/if\(!normalizedGalaxy&&isScopedGalaxy/);
  assert.match(panel,/useSyncExternalStore\(progressStore.subscribe/);
  assert.match(panel,/onValidationProgress:\(\{completed,total\}\)=>setProgress/);
  assert.match(panel,/progress.total>0&&progress.detail/);
  const manager=readFileSync(new URL(
    '../app/loc/providers/kysely-management.mjs',import.meta.url),'utf8');
  assert.match(manager,/assertZModelGalaxyManagedValues/);
  assert.match(manager,/values:galaxyValidated\\?null:modelValues/);
  assert.doesNotMatch(panel,/from 'tanstack|from 'swr/);
});
