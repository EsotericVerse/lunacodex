import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertZModelGalaxyManagedValues,modelWriteSchemaForSqlTable}
  from '../zenstack/import-validation.mjs';
import {modelNameForSql} from '../zenstack/model-column-guard.mjs';

const article=Object.freeze({
  uid:'TEST0001',title:'Existing content',content:'Private article body',
  site:'threads',date:'2026-11-12',
  createtime:'2026-11-12T00:00:00.000Z',
  target_id:null,media_link:null,statics:true,culture:true
});

test('all existing and dynamically scoped Galaxy models share one cached Zod schema',()=>{
  assert.equal(modelNameForSql('silver','lo3rwang_galaxy'),'Lo3rwangGalaxy');
  assert.equal(modelNameForSql('silver','lrunes_galaxy'),'LrunesGalaxy');
  assert.equal(modelNameForSql('silver','demo_galaxy'),'Lo3rwangGalaxy');
  assert.equal(modelWriteSchemaForSqlTable('silver.demo_galaxy'),
    modelWriteSchemaForSqlTable('silver.lo3rwang_galaxy'));
  for(const table of ['silver.lo3rwang_galaxy','silver.lrunes_galaxy',
    'silver.demo_galaxy']){
    assert.equal(assertZModelGalaxyManagedValues(table,'insert',[article]),true);
    assert.equal(assertZModelGalaxyManagedValues(table,'upsert',[article]),true);
  }
});

test('Galaxy INSERT and UPSERT reject malformed model values without changing input',()=>{
  const rows=[{...article,uid:'TEST0002'}];
  assert.equal(assertZModelGalaxyManagedValues('silver.demo_galaxy','insert',rows),true);
  assert.equal(rows[0].uid,'TEST0002');
  assert.equal(rows[0].date,'2026-11-12');
  for(const changes of [
    {uid:'short'}, {uid:'TEST00001'}, {uid:'TEST000!'},
    {source_id:'bad'}, {statics:'false'}, {target_id:[1]},
    {createtime:'not-a-date'}, {intruder_column:'unknown'}
  ]){
    assert.throws(()=>assertZModelGalaxyManagedValues('silver.demo_galaxy',
      'upsert',[{...article,...changes}]),/LOC Galaxy ZModel 寫入驗證失敗/);
  }
});

test('Galaxy partial UPDATE retains untouched fields and validates known types',()=>{
  const patch={title:'Edited',place_id:'PLACE001',target_id:['LINK0001']};
  const original=JSON.stringify(patch);
  assert.equal(assertZModelGalaxyManagedValues('silver.demo_galaxy','update',patch),true);
  assert.equal(JSON.stringify(patch),original,'validation must never mutate values');
  for(const invalid of [
    {source_id:'SHORT'}, {ref_id:'LONGERTHAN8'}, {place_id:'invalid!'},
    {search:'true'}, {target_id:[123]}, {unmodeled_key:123}
  ]){
    assert.throws(()=>assertZModelGalaxyManagedValues('silver.demo_galaxy',
      'update',invalid),/LOC Galaxy ZModel 寫入驗證失敗/);
  }
});

test('batch article enrichment preserves empty-place no-op and real CHAR(8) checks',()=>{
  const batch=[{uid:'TEST0001',place_id:'',title:'New'},
    {uid:'TEST0002',place_id:'PLACE001',media_link:['file-id']}];
  const input=JSON.stringify(batch);
  assert.equal(assertZModelGalaxyManagedValues('silver.demo_galaxy',
    'update_batch',batch),true);
  assert.equal(JSON.stringify(batch),input,'empty place remains unchanged for existing SQL');
  for(const invalid of [
    [{uid:'SHORT',title:'x'}],
    [{uid:'TEST0001',place_id:'BAD'}],
    [{uid:'TEST0001',content:12}],
    [{title:'missing uid'}],
    [{uid:'TEST0001',not_a_column:1}]
  ]){
    assert.throws(()=>assertZModelGalaxyManagedValues('silver.demo_galaxy',
      'update_batch',invalid),/LOC Galaxy ZModel 寫入驗證失敗/);
  }
});

test('invalid Galaxy managed writes expose only field name and row position',()=>{
  const privateText='DO_NOT_ECHO_PRIVATE_ARTICLE';
  let error;
  try{
    assertZModelGalaxyManagedValues('silver.demo_galaxy','update',
      {content:privateText,ref_id:'BAD'});
  }catch(caught){error=caught;}
  assert.ok(error);
  assert.match(error.message,/第 1 筆 ref_id/);
  assert.doesNotMatch(error.message,/DO_NOT_ECHO_PRIVATE_ARTICLE/);
});

test('unmodeled or non-Galaxy writes do not acquire a new model authority',()=>{
  assert.equal(assertZModelGalaxyManagedValues('api.manage','update',{id:'loc'}),false);
  assert.equal(assertZModelGalaxyManagedValues('silver.custom_relation',
    'update',{arbitrary:'x'}),false);
  assert.equal(assertZModelGalaxyManagedValues('silver.demo_galaxy',
    'delete',null),false);
  assert.throws(()=>assertZModelGalaxyManagedValues('silver.demo_galaxy',
    'update_batch',null),/Invalid LOC Galaxy managed rows/);
});

test('server validates Galaxy values after authorization, before SQL, without a new query',()=>{
  const source=readFileSync(new URL('../app/loc/providers/kysely-management.mjs',
    import.meta.url),'utf8');
  const auth=source.indexOf('await authorizeRelation(trx,table,operation,values,filters,rows)');
  const zod=source.indexOf('const galaxyValidated=assertZModelGalaxyManagedValues(');
  const model=source.indexOf('verifyModeledSqlFields({',zod);
  const firstSql=source.indexOf('await sql\x60reset role\x60',zod);
  assert.ok(auth!==-1&&auth<zod&&zod<model&&model<firstSql);
  assert.match(source,/values:galaxyValidated\?null:modelValues,filters/);
  assert.doesNotMatch(source,/new Pool\(|createConnection\(/);
});
