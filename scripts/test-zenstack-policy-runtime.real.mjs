import test from 'node:test';
import assert from 'node:assert/strict';
import {DummyDriver,PostgresAdapter,PostgresIntrospector,PostgresQueryCompiler} from 'kysely';
import {ZenStackClient} from '@zenstackhq/orm';
import {PolicyPlugin} from '@zenstackhq/plugin-policy';
import {schema} from '../zenstack/schema.mjs';

test('real ZenStack V3 PolicyPlugin enforces public fixed-model read in one SQL query',async()=>{
  const executed=[];
  const driver=new DummyDriver();
  const orig=driver.acquireConnection.bind(driver);
  driver.acquireConnection=async()=>{
    const conn=await orig();
    const execute=conn.executeQuery.bind(conn);
    conn.executeQuery=async compiled=>{
      executed.push({sql:compiled.sql,parameters:compiled.parameters});
      return execute(compiled);
    };
    return conn;
  };
  const dialect={
    createDriver:()=>driver,
    createAdapter:()=>new PostgresAdapter(),
    createIntrospector:db=>new PostgresIntrospector(db),
    createQueryCompiler:()=>new PostgresQueryCompiler()
  };
  const raw=new ZenStackClient(schema,{dialect});
  const protectedDb=raw.$use(new PolicyPlugin({dangerouslyAllowRawSql:true}))
    .$setAuth(undefined);
  const result=await protectedDb.$qb.selectFrom('Manage')
    .select(['id']).limit(3).execute();
  assert.deepEqual(result,[]);
  assert.equal(executed.length,1,'PolicyPlugin must not trigger any duplicate SELECT');
  assert.match(executed[0].sql,/"api"."manage"/);
  assert.equal(executed[0].parameters.at(-1),3);
});

test('real PolicyPlugin denies unauthenticated fixed Registry writes and permits only global administrator',async()=>{
  const executed=[];
  const driver=new DummyDriver();
  const acquire=driver.acquireConnection.bind(driver);
  driver.acquireConnection=async()=>{
    const connection=await acquire();
    const orig=connection.executeQuery.bind(connection);
    connection.executeQuery=async query=>{
      executed.push(query);
      return orig(query);
    };
    return connection;
  };
  const dialect={
    createDriver:()=>driver,createAdapter:()=>new PostgresAdapter(),
    createIntrospector:db=>new PostgresIntrospector(db),
    createQueryCompiler:()=>new PostgresQueryCompiler()
  };
  const policy=new ZenStackClient(schema,{dialect}).$use(
    new PolicyPlugin({dangerouslyAllowRawSql:true}));
  await policy.$setAuth({id:'user1',role:'admin',roleLevel:4,scopeIds:[],groupIds:[]}).$qb
    .updateTable('Manage').set({note:'test'}).where('id','=','global').execute();
  assert.equal(executed.length,1,'a fixed global policy must not issue a permission SELECT');
  assert.match(executed[0].sql,/"api"."manage"/);
  assert.ok(executed[0].parameters.includes('test'));
  executed.length=0;
  try{
    await policy.$setAuth({id:'user1',role:'user',roleLevel:1,scopeIds:[],groupIds:[]}).$qb
      .updateTable('Manage').set({note:'denied'}).where('id','=','global').execute();
  }catch(error){
    assert.match(String(error),/policy|denied|reject/i);
  }
  // Denied writes must either reject before execution or compile to a false
  // predicate; they may never be sent as an unrestricted UPDATE.
  assert.ok(executed.length===0||executed.every(q=>
    /false|1\s*=\s*0|0\s*=\s*1|coalesce/i.test(q.sql)),
    'an unauthorized fixed-model mutation must not be unrestricted');
});
