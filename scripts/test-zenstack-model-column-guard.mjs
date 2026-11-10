import test from 'node:test';
import assert from 'node:assert/strict';
import {modelFieldsForSql,verifyModeledSqlFields}
  from '../zenstack/model-column-guard.mjs';

test('Kysely fallback derives known table/column contracts from ZenStack ZModel',()=>{
  for(const name of ['lo3rwang_galaxy','lrunes_galaxy','alpha_galaxy'])
    assert.ok(Object.hasOwn(modelFieldsForSql('silver',name),'uid'));
  assert.ok(Object.hasOwn(modelFieldsForSql('silver','demo_anchor'),'attr'));
  assert.ok(Object.hasOwn(modelFieldsForSql('silver','loc_blocks'),'block_order'));
  assert.ok(Object.hasOwn(modelFieldsForSql('api','manage'),'active'));
  assert.equal(modelFieldsForSql('silver','external_unmodeled'),null);
});

test('known projections, filters, sorting and insert/upsert columns use one model contract',()=>{
  assert.equal(verifyModeledSqlFields({
    schema:'silver',table:'alpha_galaxy',
    columns:['uid','title','media_link'],
    filters:[{column:'search'}],orders:[{column:'createtime'}],
    values:[{uid:'Ab12Cd34',title:'示例'}],onConflict:['uid']
  }),true);
  assert.equal(verifyModeledSqlFields({
    schema:'silver',table:'external_unmodeled',columns:['vendor_column']
  }),false);
});

test('unknown modeled columns are rejected without connecting to a database',()=>{
  for(const input of [
    {columns:['invented']},
    {filters:[{column:'invented'}]},
    {orders:[{column:'invented'}]},
    {values:{invented:true}},
    {onConflict:['invented']}
  ])assert.throws(()=>verifyModeledSqlFields({
    schema:'silver',table:'alpha_galaxy',...input
  }),/not defined in the LOC ZModel/);
});
