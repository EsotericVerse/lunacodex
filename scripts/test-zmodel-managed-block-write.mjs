import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Kysely,DummyDriver,PostgresAdapter,PostgresIntrospector,
  PostgresQueryCompiler} from 'kysely';
import {modelWriteSchemaForSqlTable,importSchemaForSqlTable}
  from '../zenstack/import-validation.mjs';
import {verifyModeledSqlFields} from '../zenstack/model-column-guard.mjs';
import {saveBlocksKysely} from '../app/loc/providers/kysely-blocks.mjs';

const record={
  uid:'BLK12345',page_name:'index',block_order:0,
  block_eyebrow:'',block_title:'私人資料自行保管',block_subtitle:'',
  block_text:'LocalFile remains on device.',block_entity:[],
  block_image:null
};

function mockDialect(queries){
  const driver=new DummyDriver();
  const acquire=driver.acquireConnection.bind(driver);
  driver.acquireConnection=async()=>{
    const conn=await acquire();
    conn.executeQuery=async compiled=>{
      queries.push(compiled);
      return {rows:[],numAffectedRows:1n};
    };
    return conn;
  };
  return {createDriver:()=>driver,createAdapter:()=>new PostgresAdapter(),
    createIntrospector:db=>new PostgresIntrospector(db),
    createQueryCompiler:()=>new PostgresQueryCompiler()};
}

test('Galaxy and Block use one cached ZenStack-derived Zod write-schema factory',()=>{
  const galaxy=modelWriteSchemaForSqlTable('silver.lo3rwang_galaxy');
  assert.equal(galaxy,importSchemaForSqlTable('silver.lo3rwang_galaxy'));
  const block=modelWriteSchemaForSqlTable('silver.lo3rwang_blocks');
  assert.equal(block,modelWriteSchemaForSqlTable('silver.any_blocks'));
  for(const relation of ['silver.lo3rwang_blocks','silver.lrunes_blocks',
    'silver.loc_blocks','silver.any_blocks']){
    assert.equal(modelWriteSchemaForSqlTable(relation).safeParse(record).success,
      true,relation);
  }
});

test('ZModel-backed Block validator checks CHAR(8), Int, JSON and known fields',()=>{
  const validator=modelWriteSchemaForSqlTable('silver.demo_blocks');
  for(const changes of [
    {uid:'TOOSHORT'}, {uid:'TOOLONG01'}, {uid:'INVALID!'},
    {block_order:'0'}, {block_order:0.5},
    {block_entity:()=>{}}, {nonexistent_column:'private'}
  ]){
    const row={...record,...changes};
    assert.equal(validator.safeParse(row).success,false,
      JSON.stringify(Object.keys(changes)));
  }
});

test('Block save executes same one SELECT and one Kysely UPSERT with no extra SQL',async()=>{
  const queries=[];
  const db=new Kysely({dialect:mockDialect(queries)});
  const result=await saveBlocksKysely(db,{
    p_scope_id:'demo',p_type:'index',p_rows:[{...record,block_image:{src:'local'}}]
  });
  assert.equal(result.count,1);
  assert.equal(result.rows[0].block_image,'{"src":"local"}');
  assert.equal(queries.length,2);
  assert.match(queries[0].sql,/select.+from "silver"."demo_blocks"/is);
  assert.match(queries[1].sql,/insert into "silver"."demo_blocks"/i);
  await db.destroy();
});

test('Invalid Block writes fail before the first Kysely query',async()=>{
  const queries=[];
  const db=new Kysely({dialect:mockDialect(queries)});
  for(const bad of [
    {uid:'SHORT'}, {uid:'INVALID!'}, {block_order:3.5},
    {block_entity:'not-JSON-container'}, {unknown_key:'x'}
  ]){
    await assert.rejects(()=>saveBlocksKysely(db,{
      p_scope_id:'demo',p_type:'index',p_rows:[{...record,...bad}]
    }),/Invalid Block data|Duplicate Block UID or order|Invalid Block entities/);
  }
  assert.equal(queries.length,0);
  await db.destroy();
});

test('Managed writes use the same ZModel field guard before trusted SQL',()=>{
  assert.equal(verifyModeledSqlFields({
    schema:'api',table:'manage',values:{id:'demo',manage_role:'scope'}
  }),true);
  assert.equal(verifyModeledSqlFields({
    schema:'silver',table:'demo_blocks',
    values:[{uid:'BLK12345',page_name:'index',block_order:0}]
  }),true);
  assert.throws(()=>verifyModeledSqlFields({
    schema:'api',table:'manage',values:{inventedAdminColumn:true}
  }),/ZModel/);
  assert.throws(()=>verifyModeledSqlFields({
    schema:'silver',table:'demo_blocks',
    filters:[{column:'inventedColumn',operator:'eq',value:'x'}]
  }),/ZModel/);
  assert.equal(verifyModeledSqlFields({
    schema:'silver',table:'unknown_custom_name',values:{custom:'value'}
  }),false);

  const source=readFileSync(new URL(
    '../app/loc/providers/kysely-management.mjs',import.meta.url),'utf8');
  assert.ok(source.indexOf('await authorizeRelation(')<source.indexOf('verifyModeledSqlFields({'));
  assert.ok(source.indexOf('verifyModeledSqlFields({')<source.indexOf('await sql\x60reset role\x60'));
  assert.match(source,/values:galaxyValidated\|\|anchorBlockValidated\?null:modelValues,filters/);
});
