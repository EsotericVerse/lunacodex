import test from 'node:test';
import assert from 'node:assert/strict';
import {DummyDriver,PostgresAdapter,PostgresIntrospector,PostgresQueryCompiler} from 'kysely';
import {createScopedLocClient} from '../zenstack/client.mjs';
import {executePortableMcp} from '../app/loc/providers/kysely-mcp.mjs';
import {readFileSync} from 'node:fs';

function scoped(scopeId='lo3rwang'){
  const queries=[];
  const driver=new DummyDriver();
  const acquire=driver.acquireConnection.bind(driver);
  driver.acquireConnection=async()=>{
    const connection=await acquire();
    const execute=connection.executeQuery.bind(connection);
    connection.executeQuery=async query=>{
      queries.push(query);
      return execute(query);
    };
    return connection;
  };
  const dialect={
    createDriver:()=>driver,
    createAdapter:()=>new PostgresAdapter(),
    createIntrospector:db=>new PostgresIntrospector(db),
    createQueryCompiler:()=>new PostgresQueryCompiler()
  };
  return {client:createScopedLocClient({dialect,scopeId}),queries};
}
const authorized={
  provider:'loc',me:true,grants:['lo3rwang:read'],
  sub:'loc_authenticated_subject',email:'reader@example.org'
};
test('MCP Galaxy UID read executes its existing row guards through scoped ZenStack',async()=>{
  const {client,queries}=scoped();
  const result=await executePortableMcp(client.$qb,{
    kind:'mcp-read',scopeid:'lo3rwang',uid:'Ab12Cd34',site:'mcp'
  },authorized,{engine:'postgres',namespace:'silver',scopedZModel:true});
  assert.deepEqual(result.data,[]);
  assert.equal(queries.length,1);
  const {sql,parameters}=queries[0];
  assert.match(sql,/"silver"\."lo3rwang_galaxy"/);
  assert.match(sql,/"uid"/);
  assert.match(sql,/"site"/);
  assert.match(sql,/"site_id"/);
  assert.match(sql,/lower\("title"\)/);
  assert.ok(parameters.includes('Ab12Cd34'));
  assert.ok(parameters.includes('mcp'));
  assert.ok(!sql.includes('SELECT *'),'MCP must have a bounded typed projection');
});
test('MCP scoped ZenStack changes the physical Galaxy table for each Scope',async()=>{
  const {client,queries}=scoped('lrunes');
  const result=await executePortableMcp(client.$qb,{
    kind:'mcp-read',scopeid:'lrunes',uid:'Aa12BBc3',site:'mcp'
  },{...authorized,grants:['lrunes:read']},
  {engine:'postgres',namespace:'silver',scopedZModel:true});
  assert.deepEqual(result.data,[]);
  assert.equal(queries.length,1);
  assert.match(queries[0].sql,/"silver"\."lrunes_galaxy"/);
  assert.doesNotMatch(queries[0].sql,/lo3rwang_galaxy/);
});
test('MCP must verify Scope grants before any scoped ZenStack SQL',async()=>{
  const {client,queries}=scoped();
  await assert.rejects(executePortableMcp(client.$qb,{
    kind:'mcp-read',scopeid:'lo3rwang',uid:'Ab12Cd34'
  },{...authorized,grants:[]},
  {engine:'postgres',namespace:'silver',scopedZModel:true}),
  error=>error.httpStatus===403);
  assert.equal(queries.length,0);
});
test('MCP never mixes a scoped Galaxy model with an external SQL field map',async()=>{
  const {client,queries}=scoped();
  await assert.rejects(executePortableMcp(client.$qb,{
    kind:'mcp-read',scopeid:'lo3rwang',uid:'Ab12Cd34'
  },authorized,{engine:'postgres',namespace:'silver',scopedZModel:true,
    fieldMap:{uid:'other_id'}}),error=>error.httpStatus===503);
  assert.equal(queries.length,0);
});
test('MCP uses model query builder after authorization, retaining raw adapters for mapped targets',()=>{
  const pub=readFileSync(new URL('../app/loc/mcp/galaxy-read.mjs',import.meta.url),'utf8');
  const priv=readFileSync(new URL('../app/loc/mcp/private-galaxy.mjs',import.meta.url),'utf8');
  assert.match(pub,/return \{db:client\.\$qb,table:'Galaxy'\}/);
  assert.match(priv,/const queryDb=useScopedZModel\?/);
  assert.match(priv,/scopedZModel:useScopedZModel/);
  assert.match(priv,/const rights=await locMcpPermissionsForEmail/);
  assert.match(priv,/if\(!canRead\)throw denied/);
});
