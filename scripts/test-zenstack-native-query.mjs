import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Kysely,DummyDriver,PostgresAdapter,PostgresIntrospector,PostgresQueryCompiler} from 'kysely';
import {ZenStackClient} from '@zenstackhq/orm';
import {PolicyPlugin} from '@zenstackhq/plugin-policy';
import {schema} from '../zenstack/schema.mjs';
import {createScopedLocClient} from '../zenstack/client.mjs';
import {withFixedPolicyRead} from '../zenstack/policy-runtime.mjs';
import {nativeReadPlan,executeNativeRead} from '../zenstack/native-query.mjs';
import {zmodelRegistryJoin} from '../zenstack/model-column-guard.mjs';

const simple={kind:'query',operation:'select',schema:'silver',
  table:'test_galaxy',columns:['uid','title'],filters:[
    {column:'uid',operator:'eq',value:'Ab12Cd34'}],
  orders:[{column:'uid',ascending:false}],limit:8,offset:2};

function dummyDialect(executed){
  const driver=new DummyDriver();
  const acquire=driver.acquireConnection.bind(driver);
  driver.acquireConnection=async()=>{
    const connection=await acquire();
    const run=connection.executeQuery.bind(connection);
    connection.executeQuery=async query=>{executed.push(query);return run(query);};
    return connection;
  };
  return {createDriver:()=>driver,createAdapter:()=>new PostgresAdapter(),
    createIntrospector:db=>new PostgresIntrospector(db),
    createQueryCompiler:()=>new PostgresQueryCompiler()};
}
test('native scope select retains columns, filters, order and bounded pagination',()=>{
  const plan=nativeReadPlan(simple,'Galaxy');
  assert.deepEqual(plan.select,{uid:true,title:true});
  assert.deepEqual(plan.where,{AND:[{uid:{equals:'Ab12Cd34'}}]});
  assert.deepEqual(plan.orderBy,[{uid:'desc'}]);
  assert.equal(plan.take,8);assert.equal(plan.skip,2);
});
test('unbounded native SELECT does not inherit a Data API Max Rows limit',()=>{
  const {limit,...all}=simple;
  const unlimited=nativeReadPlan(all,'Galaxy');
  assert.equal(Object.hasOwn(unlimited,'take'),false);
  assert.equal(nativeReadPlan({...simple,limit:15000,offset:10000001},'Galaxy').take,15000);
});
test('unsupported filters and coercible column values keep the Kysely path',()=>{
  for(const change of [
    {or:['uid.eq.Ab12Cd34']},{columns:['*']},{columns:['content; DROP TABLE']},{columns:['uid','media_link']},
    {filters:[{column:'content',operator:'contains',value:'one'}]},
    {filters:[{column:'notAColumn',operator:'eq',value:'one'}]},
    {filters:[{column:'culture',operator:'eq',value:'true'}]},
    {filters:[{column:'date',operator:'eq',value:'2026-11-08'}]},
    {operation:'update'}
  ])assert.equal(nativeReadPlan({...simple,...change},'Galaxy'),null);
  assert.equal(nativeReadPlan(simple,'NotAModel'),null);
});
test('native fixed read uses the installed PolicyPlugin and one SQL SELECT',async()=>{
  const executed=[],dialect=dummyDialect(executed);
  const body={kind:'query',operation:'select',schema:'api',
    table:'manage',columns:['id'],filters:[],orders:[],limit:3};
  const result=await withFixedPolicyRead({},{engine:'postgres',provider:'supabase'},
    body,'anon',{}, {dialect,ZenStackClient,PolicyPlugin},
    (qb,modelName,client)=>executeNativeRead(client,body,modelName));
  assert.deepEqual(result,{data:[],count:null});
  assert.equal(executed.length,1);
  assert.match(executed[0].sql,/"api"\."manage"/);
  assert.ok(executed[0].parameters.includes(3));
});
test('native Scope query uses the authorized existing dialect and mapped table',async()=>{
  const executed=[],dialect=dummyDialect(executed);
  const client=createScopedLocClient({dialect,scopeId:'alpha',namespace:'silver'});
  const result=await executeNativeRead(client,simple,'Galaxy');
  assert.deepEqual(result,{data:[],count:null});
  assert.equal(executed.length,1);
  assert.match(executed[0].sql,/"silver"\."alpha_galaxy"/);
  assert.ok(executed[0].parameters.includes('Ab12Cd34'));
});
test('count/head uses the ORM count without loading any article row',async()=>{
  let selected=0,counts=0;
  const client={galaxy:{
    count:async()=>{counts++;return 13},
    findMany:async()=>{selected++;return []}
  }};
  const result=await executeNativeRead(client,{...simple,head:true,count:true},'Galaxy');
  assert.deepEqual(result,{data:null,count:13});
  assert.equal(selected,0);assert.equal(counts,1);
});

test('scoped $qb fallback uses mapped ZModel name to preserve SQL namespace',async()=>{
  const executed=[],dialect=dummyDialect(executed);
  const scoped=createScopedLocClient({dialect,scopeId:'alpha',namespace:'silver'});
  const result=await scoped.$qb.selectFrom('Galaxy')
    .select(['uid']).where('site','=','facebook').limit(5).execute();
  assert.deepEqual(result,[]);
  assert.equal(executed.length,1);
  assert.match(executed[0].sql,/"silver"."alpha_galaxy"/);
});

test('ZModel Registry JOIN compiles to the original one-SQL cross-schema join',async()=>{
  const executed=[],db=new Kysely({dialect:dummyDialect(executed)});
  const inner=zmodelRegistryJoin(db)
    .select(['m.id as id','l.display_name as display_name','m.active as active'])
    .where('m.manage_role','=','scope').where('m.active','=',true)
    .orderBy('m.sort_order','asc').compile();
  assert.match(inner.sql,/from "api"."manage" as "m"/i);
  assert.match(inner.sql,/inner join "silver"."loc" as "l" on "l"."id" = "m"."id"/i);
  assert.deepEqual(inner.parameters,['scope',true]);

  const left=zmodelRegistryJoin(db,{optionalLoc:true})
    .select(['m.id as id','l.birthday as birthday'])
    .where('m.id','=','lo3rwang').compile();
  assert.match(left.sql,/left join "silver"."loc" as "l" on "l"."id" = "m"."id"/i);
  assert.deepEqual(left.parameters,['lo3rwang']);

  // No SQL runs during model mapping / query compilation.
  assert.equal(executed.length,0);
  await db.destroy();
});
