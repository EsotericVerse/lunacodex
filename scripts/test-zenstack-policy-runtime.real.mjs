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
