import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fixedPolicyReadModel,fixedPolicyReader,withFixedPolicyRead} from
  '../zenstack/policy-runtime.mjs';

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
