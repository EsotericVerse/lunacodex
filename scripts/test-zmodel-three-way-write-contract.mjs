import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  modelWriteSchemaForSqlTable,assertZModelGalaxyManagedValues,
  assertZModelAnchorBlockManagedValues
} from '../zenstack/import-validation.mjs';
import {modelFieldsForSql} from '../zenstack/model-column-guard.mjs';

const anchor={uid:'PLACE001',type:'point',title:'示範地點',
  description:null,invisible:false,attr:{longitude:121.5,latitude:25.0}};
const block={uid:'BLOCK001',page_name:'index',block_order:0,
  block_title:'文字',block_text:'內容',block_eyebrow:'',
  block_subtitle:'',block_image:null,block_entity:[]};
const galaxy={uid:'ARTICLE1',title:'文字',content:'內容',site:'threads',
  createtime:'2026-11-12T00:00:00.000Z',date:'2026-11-12',
  statics:true,culture:true};

test('Galaxy, Anchor and Block use the same frozen ZenStack schema factory',()=>{
  for(const [name,row] of [
    ['galaxy',galaxy],['anchor',anchor],['blocks',block]
  ]){
    const official='silver.lo3rwang_'+name;
    const dynamic='silver.demo_'+name;
    assert.equal(modelWriteSchemaForSqlTable(official),
      modelWriteSchemaForSqlTable(dynamic));
    assert.equal(modelWriteSchemaForSqlTable(dynamic).safeParse(row).success,true);
    assert.ok(Object.keys(modelFieldsForSql('silver','demo_'+name)).length>=8);
  }
  assert.equal(modelWriteSchemaForSqlTable('silver.lrunes_anchor')
    .safeParse(anchor).success,true);
  assert.equal(modelWriteSchemaForSqlTable('silver.lrunes_blocks')
    .safeParse(block).success,true);
  assert.equal(modelWriteSchemaForSqlTable('silver.loc_blocks')
    .safeParse(block).success,true);
});

test('Anchor INSERT/UPSERT and partial UPDATE enforce UID, Boolean, JSON and column types',()=>{
  for(const table of ['silver.demo_anchor','silver.lo3rwang_anchor',
    'silver.lrunes_anchor','silver.loc_anchor']){
    assert.equal(assertZModelAnchorBlockManagedValues(table,'insert',[anchor]),true);
    assert.equal(assertZModelAnchorBlockManagedValues(table,'upsert',[anchor]),true);
    assert.equal(assertZModelAnchorBlockManagedValues(table,'update',
      {title:'更新',description:null,invisible:true,attr:{name:'A'}}),true);
    for(const invalid of [
      {uid:'BAD'}, {uid:'INVALID!'}, {invisible:'true'},
      {attr:()=>1}, {unknown_column:'NO'}, {num:1.5},
      {num:'9223372036854775808'}, {num:'not-numeric'}
    ]){
      assert.throws(()=>assertZModelAnchorBlockManagedValues(
        table,'insert',[{...anchor,...invalid}]),/ZModel 寫入驗證失敗/);
    }
    assert.throws(()=>assertZModelAnchorBlockManagedValues(table,'update',
      {uid:'SHORT'}),/ZModel 寫入驗證失敗/);
  }
});

test('Anchor number is accepted as JSON-safe int8 without data transformation',()=>{
  for(const input of [2,0,-1,9007199254740991,'9223372036854775807']){
    const row={...anchor,num:input};
    assert.equal(assertZModelAnchorBlockManagedValues('silver.demo_anchor',
      'insert',[row]),true,String(input));
    assert.equal(row.num,input);
  }
});

test('semantic Anchor payloads use the declared ZModel value type for attr',()=>{
  assert.equal(assertZModelAnchorBlockManagedValues('silver.loc_anchor','insert',[
    {uid:'SOURCE01',type:'domain',attr:{uid:['FROM001']}}
  ]),true);
  assert.equal(assertZModelAnchorBlockManagedValues('silver.demo_anchor','insert',[
    {uid:'PAT00001',type:'pattern',attr:{'DB000001':['ARTICLE1']}}
  ]),true);
  assert.throws(()=>assertZModelAnchorBlockManagedValues('silver.demo_anchor','insert',[
    {uid:'POINT001',type:'point',attr:{longitude:'not-a-number'}}
  ]),/LOC Anchor ZModel payload/);
});

test('Block INSERT and partial UPDATE reuse ZModel and preserve page business rules',()=>{
  for(const table of ['silver.loc_blocks','silver.lo3rwang_blocks',
    'silver.lrunes_blocks','silver.demo_blocks']){
    assert.equal(assertZModelAnchorBlockManagedValues(table,'insert',[block]),true);
    assert.equal(assertZModelAnchorBlockManagedValues(table,'update',
      {block_text:'編輯後'}),true);
    for(const changes of [
      {uid:'SHORT'}, {uid:'INVALID!'}, {block_order:'0'},
      {block_entity:()=>{}}, {private_column:'bad'}
    ])assert.throws(()=>assertZModelAnchorBlockManagedValues(table,
      'insert',[{...block,...changes}]),/ZModel 寫入驗證失敗/);
  }
});

test('Galaxy managed updates still use the same strict Zod validator',()=>{
  assert.equal(assertZModelGalaxyManagedValues('silver.demo_galaxy',
    'insert',[galaxy]),true);
  assert.equal(assertZModelGalaxyManagedValues('silver.demo_galaxy',
    'update',{title:'更新'}),true);
  assert.throws(()=>assertZModelGalaxyManagedValues('silver.demo_galaxy',
    'update',{private_column:true}),/ZModel 寫入驗證失敗/);
});

test('unknown models are not implicitly authorized while LOC source Anchor is modeled',()=>{
  assert.equal(assertZModelAnchorBlockManagedValues('silver.demo_custom',
    'insert',[anchor]),false);
  assert.equal(assertZModelAnchorBlockManagedValues('silver.loc_anchor',
    'insert',[anchor]),true);
  assert.equal(assertZModelAnchorBlockManagedValues('api.manage',
    'update',{id:'loc'}),false);
});

test('invalid data diagnostics contain only field labels, not article text',()=>{
  const privateText='SECRET_ARTICLE_TEXT_DO_NOT_ECHO';
  let error;
  try{
    assertZModelAnchorBlockManagedValues('silver.demo_anchor','insert',
      [{...anchor,title:privateText,invisible:'false'}]);
  }catch(e){error=e;}
  assert.ok(error);
  assert.match(error.message,/invisible/);
  assert.doesNotMatch(error.message,/SECRET_ARTICLE_TEXT_DO_NOT_ECHO/);
});

test('all three model validations run before managed SQL, never via Auth or DB',()=>{
  const manager=readFileSync(new URL('../app/loc/providers/kysely-management.mjs',
    import.meta.url),'utf8');
  const anchorSource=readFileSync(new URL('../app/loc/providers/kysely-anchor.mjs',
    import.meta.url),'utf8');
  const blocks=readFileSync(new URL('../app/loc/providers/kysely-blocks.mjs',
    import.meta.url),'utf8');
  const authorized=manager.indexOf('await authorizeRelation(');
  const galaxyCheck=manager.indexOf('const galaxyValidated=assertZModelGalaxyManagedValues(');
  const anchorCheck=manager.indexOf('const anchorBlockValidated=');
  const sqlFirst=manager.indexOf('await sql`reset role`');
  assert.ok(authorized>=0&&authorized<galaxyCheck&&galaxyCheck<anchorCheck&&
    anchorCheck<sqlFirst);
  assert.match(manager,/values:galaxyValidated\|\|anchorBlockValidated\?null:modelValues/);
  assert.match(anchorSource,/assertZModelAnchorBlockManagedValues\(anchor,'insert',\[row\]\)/);
  assert.match(anchorSource,/assertZModelAnchorBlockManagedValues\(anchor,'update',values\)/);
  assert.match(anchorSource,/assertZModelAnchorBlockManagedValues\('silver.'\+scope\+'_anchor','insert'/);
  assert.match(anchorSource,/assertZModelAnchorBlockManagedValues\('silver.'\+scope\+'_anchor','update'/);
  assert.match(blocks,/blockSchema\.safeParse\(normalized\)/);
  assert.equal((anchorSource.match(/const ANCHOR_COLUMNS=/g)||[]).length,1);
  assert.doesNotMatch(manager,/new Pool\(/);
});
