import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fixedPolicyReadModel,fixedPolicyWriteModel,fixedPolicyReader,
  withFixedPolicyRead,withFixedPolicyWrite} from '../zenstack/policy-runtime.mjs';

const pg={engine:'postgres',provider:'supabase'};
const fixed=[
  ['api','manage','Manage'],
  ['silver','loc','Loc'],
  ['silver','lo3rwang','Lo3rwang'],
  ['silver','lrunes','Lrunes']
];
test('fixed ZModel PolicyPlugin only receives the four public control SELECTs',()=>{
  for(const [schema,table,model] of fixed){
    assert.equal(fixedPolicyReadModel(pg,{kind:'query',schema,table,operation:'select'}),model);
    assert.equal(fixedPolicyReadModel(pg,{kind:'query',schema,table,operation:'update'}),null);
    assert.equal(fixedPolicyReadModel({engine:'mysql',provider:'custom'},
      {kind:'query',schema,table,operation:'select'}),null);
  }
  for(const [schema,table] of [['silver','lo3rwang_galaxy'],['silver','lrunes_anchor'],
    ['silver','loc_blocks'],['silver','runes'],['api','user_records']]){
    assert.equal(fixedPolicyReadModel(pg,{kind:'query',schema,table,operation:'select'}),null);
  }
  assert.equal(fixedPolicyReadModel(pg,{kind:'managed-write'}),null);
});

test('policy-enforced live query uses exactly one transaction and one SQL execution',async()=>{
  let created=0,plugins=0,transactions=0,executions=0;
  const auth=[];
  class ZenStackClientMock{
    constructor(schema,{dialect}){assert.ok(schema.models.Manage);assert.equal(dialect,sharedDialect);created++;}
    $use(plugin){assert.equal(plugin.options.dangerouslyAllowRawSql,true);plugins++;return this;}
    $setAuth(value){auth.push(value);return this;}
    async $transaction(callback){
      transactions++;
      return callback({$qb:{executeQuery:async()=>{executions++;return{rows:[{id:'loc'}]}}}});
    }
  }
  class PolicyPluginMock{constructor(options){this.options=options;}}
  const db={},sharedDialect={},deps={dialect:sharedDialect,
    ZenStackClient:ZenStackClientMock,PolicyPlugin:PolicyPluginMock};
  const body={kind:'query',schema:'api',table:'manage',operation:'select'};
  const target=pg;
  const run=(trx,model)=>{assert.equal(model,'Manage');return trx.executeQuery()};
  const anonymous=await withFixedPolicyRead(db,target,body,'anon',{},deps,run);
  assert.deepEqual(anonymous.rows,[{id:'loc'}]);
  await withFixedPolicyRead(db,target,body,'authenticated',
    {provider:'loc',me:true,sub:'user123'},deps,run);
  assert.equal(created,1,'reuse one ZenStack client and trusted SQL dialect per DB');
  assert.equal(plugins,1,'do not reinstall the policy on every HTTP request');
  assert.equal(transactions,2);
  assert.equal(executions,2,'no duplicate SQL execution');
  assert.deepEqual(auth,[undefined,{id:'user123',role:'authenticated'}]);
});

test('Edge actually routes model SELECTs to PolicyPlugin, not a detached schema',()=>{
  const edge=readFileSync(new URL('../supabase/functions/loc-kysely/index.ts',import.meta.url),'utf8');
  assert.match(edge,/withFixedPolicyRead\(db,target,body,role,claims/);
  assert.match(edge,/new PolicyPlugin|PolicyPlugin\}/);
  assert.match(edge,/trustedDialectForDatabase\(db\)/);
  assert.match(edge,/executeRequest\(trx,target,role,claims,body,\{modelName\}\)/);
  assert.match(edge,/db\.transaction\(\)\.execute\(trx=>/);
});

test('only verified global LOC administrator writes enter fixed-model PolicyPlugin',()=>{
  const global={provider:'loc',me:true,sub:'user123',grants:['global:manage']};
  const scope={provider:'loc',me:true,sub:'user123',grants:['lo3rwang:manage']};
  for(const [path,model] of [['api.manage','Manage'],['silver.loc','Loc']]){
    for(const operation of ['update','delete']){
      const body={kind:'managed-write',payload:{p_table:path,p_operation:operation}};
      assert.equal(fixedPolicyWriteModel(pg,body,'authenticated',global),model);
      for(const claims of [scope,{...global,me:false},{...global,provider:'clerk'},{...global,grants:[]}])
        assert.equal(fixedPolicyWriteModel(pg,body,'authenticated',claims),null);
      assert.equal(fixedPolicyWriteModel(pg,body,'anon',global),null);
      assert.equal(fixedPolicyWriteModel({engine:'mysql',provider:'custom'},body,'authenticated',global),null);
      assert.equal(fixedPolicyWriteModel({engine:'postgres',provider:'neon'},body,'authenticated',global),null);
    }
    assert.equal(fixedPolicyWriteModel(pg,{kind:'managed-write',payload:{p_table:path,p_operation:'insert'}},
      'authenticated',global),null,'bulk INSERT retains trusted batched Kysely executor');
  }
  for(const p_table of ['silver.lo3rwang','silver.lrunes','silver.lo3rwang_galaxy','api.user_records']){
    assert.equal(fixedPolicyWriteModel(pg,
      {kind:'managed-write',payload:{p_table,p_operation:'update'}},'authenticated',global),null);
  }
});

test('global fixed write uses one existing dialect and one policy transaction',async()=>{
  const logged={created:0,plugin:0,transaction:0,execution:0,auth:[]};
  class ClientMock{
    constructor(schema,{dialect}){assert.ok(schema.models.Manage);assert.equal(dialect,connectionDialect);logged.created++;}
    $use(plugin){assert.ok(plugin.options.dangerouslyAllowRawSql);logged.plugin++;return this;}
    $setAuth(value){logged.auth.push(value);return this;}
    async $transaction(cb){logged.transaction++;
      return cb({$qb:{executeQuery:async()=>{logged.execution++;return {count:1};}}});
    }
  }
  class PluginMock{constructor(options){this.options=options;}}
  const db={},connectionDialect={},dependencies={dialect:connectionDialect,
    ZenStackClient:ClientMock,PolicyPlugin:PluginMock};
  const claims={provider:'loc',me:true,sub:'user123',grants:['global:manage']};
  const body={kind:'managed-write',payload:{p_table:'api.manage',p_operation:'update'}};
  const execute=(trx,model)=>{assert.equal(model,'Manage');return trx.executeQuery()};
  assert.deepEqual(await withFixedPolicyWrite(db,pg,body,'authenticated',claims,dependencies,execute),{count:1});
  assert.deepEqual(await withFixedPolicyWrite(db,pg,body,'authenticated',claims,dependencies,execute),{count:1});
  assert.deepEqual(logged,{created:1,plugin:1,transaction:2,execution:2,
    auth:[{id:'user123',role:'admin'},{id:'user123',role:'admin'}]});
  await assert.rejects(()=>withFixedPolicyWrite(db,pg,body,'authenticated',
    {...claims,grants:['lo3rwang:manage']},dependencies,execute),
    /Global LOC policy permission required/);
  assert.equal(logged.execution,2,'a rejected write must not reach SQL');
});

test('managed Kysely fixed updates derive primary keys from SchemaDef, not pg_index',()=>{
  const management=readFileSync(new URL('../app/loc/providers/kysely-management.mjs',import.meta.url),'utf8');
  const gateway=readFileSync(new URL('../supabase/functions/loc-kysely/index.ts',import.meta.url),'utf8');
  assert.match(management,/fixedSchema\.models\[modelName\]\?\.idFields/);
  assert.match(management,/modelName\|\|\(table==='manage'/);
  assert.match(management,/if\(modelName&&\!\(modelName==='Manage'/);
  assert.match(gateway,/withFixedPolicyWrite\(db,target,body,role,claims/);
  assert.match(gateway,/fixedPolicyWriteModel\(target,body,role,claims\)/);
  assert.match(gateway,/executeManagedKyselyWrite\(trx,body,\{modelName\}\)/);
});
