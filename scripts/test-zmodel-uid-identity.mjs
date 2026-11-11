import test from 'node:test';
import assert from 'node:assert/strict';
import {schema} from '../zenstack/schema.mjs';
import {scopedZModelSchema} from '../zenstack/scoped-schema.mjs';
import {indexZModelAnchorHierarchy} from '../zenstack/anchor-hierarchy.mjs';

test('Galaxy, Anchor and Blocks models use immutable UID identity, never title',()=>{
  for(const prefix of ['Lo3rwang','Lrunes']){
    for(const kind of ['Galaxy','Anchor','Blocks']){
      const model=schema.models[prefix+kind];
      assert.deepEqual(model.idFields,['uid'],prefix+kind+' primary key');
      assert.equal(model.fields.uid.id,true);
      assert.notEqual(model.fields.title?.id,true);
      assert.notEqual(model.fields.block_title?.id,true);
    }
  }
  const scoped=scopedZModelSchema({scopeId:'lo3rwang'});
  for(const name of ['Galaxy','Anchor','Blocks'])
    assert.deepEqual(scoped.models[name].idFields,['uid']);
});

test('model relations never reference display title fields',()=>{
  for(const model of Object.values(schema.models))
    for(const field of Object.values(model.fields))
      if(field.relation){
        assert.ok(!field.relation.fields?.includes('title'),
          model.name+'.'+field.name+' must not use title as foreign key');
        assert.ok(!field.relation.references?.includes('title'),
          model.name+'.'+field.name+' must not reference title');
      }
});

test('renaming Anchor title cannot change UID-based graph links',()=>{
  const rows=[
    {uid:'AAAABBBB',type:'trace',title:'Original name',
      attr:{point:['CCCCDDDD']}},
    {uid:'CCCCDDDD',type:'point',title:'Original place',attr:{}}
  ];
  const before=indexZModelAnchorHierarchy(rows,{family:'space',strict:true});
  const after=indexZModelAnchorHierarchy(rows.map(row=>({
    ...row,title:'Renamed: '+row.title
  })),{family:'space',strict:true});
  assert.deepEqual(before.links(),after.links());
  assert.deepEqual(before.childrenOf('AAAABBBB'),['CCCCDDDD']);
  assert.deepEqual(after.childrenOf('AAAABBBB'),['CCCCDDDD']);
});
