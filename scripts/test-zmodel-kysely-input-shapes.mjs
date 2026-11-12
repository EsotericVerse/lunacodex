import test from 'node:test';
import assert from 'node:assert/strict';
import {Kysely,DummyDriver,PostgresAdapter,PostgresIntrospector,PostgresQueryCompiler} from 'kysely';
import {assertKyselyQueryShape,managedRowsIssue,managedUpdateValuesValid,
  managedFiltersValid,QUERY_FILTER_SQL,MANAGED_FILTER_SQL}
  from '../zenstack/sql-input-shape.mjs';
import {modelFieldsForSql} from '../zenstack/model-column-guard.mjs';
import {buildKyselySelectQuery,buildKyselyMutationQuery}
  from '../app/loc/providers/kysely-runtime.mjs';

const input={kind:'query',schema:'silver',table:'lo3rwang_galaxy',
  operation:'select',columns:['uid','title'],
  filters:[{column:'uid',operator:'eq',value:'Ab12Cd34'}],
  orders:[{column:'uid',ascending:false}],limit:5,offset:0};

test('Zod SQL shape preserves request references and unknown SQL values',()=>{
  const request={...input,values:{uid:'Ab12Cd34',block_entity:{private:true}}};
  assert.equal(assertKyselyQueryShape(request),request);
  assert.equal(request.values.block_entity.private,true);
  assert.equal(QUERY_FILTER_SQL.eq,'=');
  assert.equal(MANAGED_FILTER_SQL.contains,undefined);
});

test('Zod query contract rejects malformed relation and filter names before Kysely',()=>{
  for(const bad of [
    {table:'galaxy;drop'},
    {schema:'public;drop'},
    {operation:'grant'},
    {columns:['uid,*']},
    {filters:[{column:'bad-name',operator:'eq',value:'abc'}]},
    {filters:[{column:'uid',operator:'raw',value:'abc'}]},
    {orders:[{column:'uid DESC'}]},
    {or:['bad'.repeat(1),...Array(10).fill('x')]},
    {single:'all'}
  ])assert.throws(()=>assertKyselyQueryShape({...input,...bad}));
});

test('Zod managed-write shapes preserve rows, optional operator and bounded IN',()=>{
  assert.equal(managedRowsIssue([{uid:'Ab12Cd34',block_entity:{a:[1,2]}}]),'');
  assert.equal(managedRowsIssue([]),'batch');
  assert.equal(managedRowsIssue([{uid:'Ab12Cd34','bad-key':42}]),'row');
  assert.equal(managedRowsIssue([null]),'row');
  assert.equal(managedUpdateValuesValid({display_name:'New'}),true);
  assert.equal(managedUpdateValuesValid({uid:'ABC12345'}),false);
  assert.equal(managedUpdateValuesValid({id:'lo3rwang'}),false);
  assert.equal(managedFiltersValid([{column:'uid',value:'Ab12Cd34'}]),true);
  assert.equal(managedFiltersValid([{column:'uid',operator:'in',value:['Ab12Cd34']}]),true);
  assert.equal(managedFiltersValid([{column:'uid',operator:'in',value:Array(501).fill('x')}]),false);
  assert.equal(managedFiltersValid([{column:'uid',operator:'contains',value:'x'}]),false);
  assert.equal(managedFiltersValid([]),false);
});

test('Block editing uses ZModel physical column set rather than a second map',()=>{
  const first=Object.keys(modelFieldsForSql('silver','lo3rwang_blocks')).sort();
  const second=Object.keys(modelFieldsForSql('silver','lrunes_blocks')).sort();
  assert.deepEqual(first,second);
  assert.deepEqual(first,['uid','page_name','block_eyebrow','block_title','block_subtitle',
    'block_text','block_order','block_entity','block_image'].sort());
});

function dialect(){
  return {createDriver:()=>new DummyDriver(),
    createAdapter:()=>new PostgresAdapter(),
    createIntrospector:db=>new PostgresIntrospector(db),
    createQueryCompiler:()=>new PostgresQueryCompiler()};
}
test('Zod ingress + ZModel fields + Kysely SELECT compile without extra SQL',async()=>{
  const db=new Kysely({dialect:dialect()});
  const built=buildKyselySelectQuery(db,input);
  const compiled=built.query.compile();
  assert.match(compiled.sql,/"silver"\."lo3rwang_galaxy"/);
  assert.deepEqual(compiled.parameters,['Ab12Cd34',5,0]);
  assert.equal(built.request.columns[0],'uid');
  assert.throws(()=>buildKyselySelectQuery(db,{...input,columns:['not_in_zmodel']}),
    /ZModel/);
  await db.destroy();
});

test('Kysely mutations still require filters and use the same ZModel contract',async()=>{
  const db=new Kysely({dialect:dialect()});
  assert.throws(()=>buildKyselyMutationQuery(db,{
    kind:'query',schema:'silver',table:'lo3rwang_galaxy',
    operation:'delete',filters:[]
  }),/Unfiltered writes are forbidden/);
  const inserted=buildKyselyMutationQuery(db,{
    kind:'query',schema:'silver',table:'lo3rwang_galaxy',
    operation:'insert',values:{uid:'Ab12Cd34',title:'合法'},
    columns:['uid']
  });
  assert.match(inserted.query.compile().sql,/insert into "silver"\."lo3rwang_galaxy"/);
  await db.destroy();
});
