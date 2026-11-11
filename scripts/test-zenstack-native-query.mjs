import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DummyDriver,PostgresAdapter,PostgresIntrospector,PostgresQueryCompiler} from 'kysely';
import {ZenStackClient} from '@zenstackhq/orm';
import {PolicyPlugin} from '@zenstackhq/plugin-policy';
import {schema} from '../zenstack/schema.mjs';
import {createScopedLocClient} from '../zenstack/client.mjs';
import {withFixedPolicyRead} from '../zenstack/policy-runtime.mjs';
import {nativeReadPlan,executeNativeRead} from '../zenstack/native-query.mjs';

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
    {filters:[{column:'culture',operator:'eq',value:'TRUE'}]},
    {filters:[{column:'date',operator:'eq',value:'2026-02-30'}]},
    {filters:[{column:'createtime',operator:'eq',value:'2026-11-08T12:00:00'}]},
    {filters:[{column:'culture',operator:'gt',value:true}]},
    {orders:[{column:'date',ascending:true,nullsFirst:true}]},
    {operation:'update'}
  ])assert.equal(nativeReadPlan({...simple,...change},'Galaxy'),null);
  assert.equal(nativeReadPlan(simple,'NotAModel'),null);
});
test('native ZModel query safely normalizes browser boolean and calendar date filters',()=>{
  const filters=[
    {column:'culture',operator:'eq',value:'true'},
    {column:'statics',operator:'eq',value:'false'},
    {column:'date',operator:'gte',value:'2025-02-21'}
  ];
  const plan=nativeReadPlan({...simple,filters},'Galaxy');
  assert.deepEqual(plan.where.AND[0],{culture:{equals:true}});
  assert.deepEqual(plan.where.AND[1],{statics:{equals:false}});
  assert.equal(plan.where.AND[2].date.gte.toISOString(),'2025-02-21T00:00:00.000Z');
  assert.equal(plan.take,8);
  assert.equal(plan.skip,2);
});
test('native ZModel query preserves nullable and timestamp-with-timezone semantics',()=>{
  const filters=[
    {column:'date',operator:'is',value:null},
    {column:'culture',operator:'is',value:false},
    {column:'createtime',operator:'lt',value:'2026-11-11T13:05:00+08:00'}
  ];
  const plan=nativeReadPlan({...simple,filters},'Galaxy');
  assert.deepEqual(plan.where.AND[0],{date:{equals:null}});
  assert.deepEqual(plan.where.AND[1],{culture:{equals:false}});
  assert.equal(plan.where.AND[2].createtime.lt.toISOString(),'2026-11-11T05:05:00.000Z');
  // A bare local time must NOT be interpreted in the server's time zone.
  assert.equal(nativeReadPlan({...simple,filters:[{
    column:'createtime',operator:'eq',value:'2026-11-11T13:05:00'
  }]},'Galaxy'),null);
});
test('typed native SELECT compiles a complete model-mapped filter with original pagination',async()=>{
  const executed=[],dialect=dummyDialect(executed);
  const client=createScopedLocClient({dialect,scopeId:'lo3rwang'});
  const result=await executeNativeRead(client,{...simple,filters:[
    {column:'culture',operator:'eq',value:'true'},
    {column:'date',operator:'gte',value:'2025-02-21'}
  ]},'Galaxy');
  assert.deepEqual(result,{data:[],count:null});
  assert.equal(executed.length,1);
  assert.match(executed[0].sql,/"silver"."lo3rwang_galaxy"/);
  assert.ok(executed[0].parameters.includes(true));
  assert.ok(executed[0].parameters.some(v=>v instanceof Date&&
    v.toISOString()==='2025-02-21T00:00:00.000Z'));
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
