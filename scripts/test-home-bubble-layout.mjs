import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Kysely,DummyDriver,PostgresAdapter,PostgresIntrospector,PostgresQueryCompiler} from 'kysely';
import {postgresManagedJsonbValues} from '../app/loc/providers/kysely-management.mjs';
import {
  defaultHomeBubbleColumns,homeBubbleColumns,homeBubbleEntities,
  serializeHomeBubbleEntities,normalizeHomeBlockEntities
} from '../app/loc/home-block-model.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const bubble={uid:'ABC12345',title:'',text:'文字泡泡'};

test('per-page defaults and explicit 2/3/6 columns',()=>{
  assert.equal(defaultHomeBubbleColumns('index'),3);
  assert.equal(defaultHomeBubbleColumns('trace'),2);
  assert.equal(defaultHomeBubbleColumns('search'),6);
  for(const number of [2,3,6]){
    assert.equal(homeBubbleColumns([number,bubble],'index'),number);
    assert.deepEqual(homeBubbleEntities([number,bubble]),[bubble]);
    assert.equal(serializeHomeBubbleEntities(number,[bubble])[0],number);
  }
  assert.equal(homeBubbleColumns([bubble],'search'),6);
  assert.equal(homeBubbleColumns([4,bubble],'index'),3);
});

test('legacy and new JSONB arrays preserve children in their original order',()=>{
  const another={uid:'XYZ98765',title:'標題',text:'第二筆'};
  for(const value of [[bubble,another],[6,bubble,another]]){
    assert.deepEqual(normalizeHomeBlockEntities(value).map(item=>item.uid),[bubble.uid,another.uid]);
  }
  const stored=serializeHomeBubbleEntities(3,[bubble,another]);
  assert.deepEqual(stored,[3,bubble,another]);
});

test('home, inline edit, and public displays retain the same bubble layout contract',()=>{
  for(const path of ['app/loc/ScopeBlockDraftList.jsx','app/loc/ScopeBlockEditorSession.jsx']){
    const source=read(path);
    assert.match(source,/文字泡泡排列（每列）/);
    assert.match(source,/serializeBubbleEntities\(draft\.bubbleColumns/);
  }
  assert.match(read('app/loc/ScopeEditableBlocks.jsx'),/bubbleColumns:HomeBlock\.bubbleColumns/);
  assert.match(read('app/loc/LocHomeBlockDisplay.jsx'),/--loc-bubble-columns/);
  assert.match(read('app/styles/loc-about-original.css'),/--loc-bubble-columns/);
});

test('Kysely managed writes bind homepage JSONB arrays as JSON rather than PG arrays',()=>{
  const management=read('app/loc/providers/kysely-management.mjs');
  assert.match(management,/modelFieldsForSql/);
  assert.doesNotMatch(management,/MANAGED_JSONB_COLUMNS/);
  assert.match(management,/JSON\.stringify\(value\)}::jsonb/);
  assert.match(management,/\.set\(postgresManagedJsonbValues\(values,relation\)\)/);
  // Both editor variants continue providing the original [columns,...entities]
  // structure, with no UI-side JSON stringify or schema alteration.
  for(const path of ['app/loc/ScopeBlockDraftList.jsx','app/loc/ScopeBlockEditorSession.jsx']){
    assert.match(read(path),/block_entity:HomeBlock\.serializeBubbleEntities/);
  }
});


test('ZModel determines JSONB binding per physical table without treating SQL arrays as JSON',()=>{
  const db=new Kysely({dialect:{
    createDriver:()=>new DummyDriver(),
    createAdapter:()=>new PostgresAdapter(),
    createIntrospector:kysely=>new PostgresIntrospector(kysely),
    createQueryCompiler:()=>new PostgresQueryCompiler()
  }});
  const entities=[3,{uid:'ABC12345',text:'文字泡泡'}];
  const blocks=db.updateTable('silver.lo3rwang_blocks')
    .set(postgresManagedJsonbValues({block_entity:entities,page_name:'index'},
      'silver.lo3rwang_blocks'))
    .where('uid','=','ABC12345').compile();
  assert.match(blocks.sql,/"block_entity" = \$1::jsonb/);
  assert.deepEqual(blocks.parameters[0],JSON.stringify(entities));
  assert.equal(blocks.parameters[1],'index');

  const links=['https://example.org/a','https://example.org/b'];
  const galaxy=db.updateTable('silver.lo3rwang_galaxy')
    .set(postgresManagedJsonbValues({media_link:links,title:'Example'},
      'silver.lo3rwang_galaxy'))
    .where('uid','=','ABC12345').compile();
  assert.doesNotMatch(galaxy.sql,/::jsonb/);
  assert.deepEqual(galaxy.parameters[0],links);

  const profile=postgresManagedJsonbValues({status:{editing:true},theme:'light'},
    'silver.lo3rwang');
  const config=postgresManagedJsonbValues({theme:{accent:'moon'}},'silver.loc');
  const profileQuery=db.updateTable('silver.lo3rwang').set(profile)
    .where('id','=','lo3rwang').compile();
  const configQuery=db.updateTable('silver.loc').set(config)
    .where('id','=','lo3rwang').compile();
  assert.match(profileQuery.sql,/"status" = \$1::jsonb/);
  assert.doesNotMatch(profileQuery.sql,/"theme" = \$2::jsonb/);
  assert.match(configQuery.sql,/"theme" = \$1::jsonb/);
  assert.equal(configQuery.parameters[0],JSON.stringify({accent:'moon'}));
  void db.destroy();
});
