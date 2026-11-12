import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fixedPolicyReadModel,fixedPolicyWriteModel,fixedPolicyReader,
  withFixedPolicyRead,withFixedPolicyWrite} from '../zenstack/policy-runtime.mjs';
import {LOC_ROLE_LEVEL,locRolePrincipal} from '../zenstack/role-hierarchy.mjs';

const pg={engine:'postgres',provider:'custom'};
const fixed=[
  ['api','manage','Manage'],
  ['silver','loc','Loc'],
  ['silver','lo3rwang','Lo3rwang'],
  ['silver','lrunes','Lrunes'],
  ['silver','loc_blocks','LocBlocks'],
  ['silver','lo3rwang_blocks','Lo3rwangBlocks'],
  ['silver','lrunes_blocks','LrunesBlocks']
];
test('fixed ZModel PolicyPlugin receives control and Blocks SELECTs only',()=>{
  for(const [schema,table,model] of fixed){
    assert.equal(fixedPolicyReadModel(pg,{kind:'query',schema,table,operation:'select'}),model);
    assert.equal(fixedPolicyReadModel(pg,{kind:'query',schema,table,operation:'update'}),null);
    assert.equal(fixedPolicyReadModel({engine:'mysql',provider:'custom'},
      {kind:'query',schema,table,operation:'select'}),null);
  }
  for(const [schema,table] of [['silver','lo3rwang_galaxy'],['silver','lrunes_anchor'],
    ['silver','demo_blocks'],['silver','runes'],['api','user_records']]){
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
  assert.deepEqual(auth,[undefined,{id:'user123',role:'user',roleLevel:1,
    scopeIds:[],groupIds:[]}]);
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
      // The fixed policy is tied to a verified LOC control target, not its SQL host.
      assert.equal(fixedPolicyWriteModel({engine:'postgres',provider:'custom'},body,'authenticated',global),model);
      assert.equal(fixedPolicyWriteModel({engine:'postgres',provider:'independent-host'},body,'authenticated',global),model);
    }
    assert.equal(fixedPolicyWriteModel(pg,{kind:'managed-write',payload:{p_table:path,p_operation:'insert'}},
      'authenticated',global),null,'bulk INSERT retains trusted batched Kysely executor');
    const [schema,table]=path.split('.');
    for(const operation of ['update','delete']){
      assert.equal(fixedPolicyWriteModel(pg,
        {kind:'query',schema,table,operation},'authenticated',global),model);
      assert.equal(fixedPolicyWriteModel(pg,
        {kind:'query',schema,table,operation},'authenticated',scope),null);
    }
    assert.equal(fixedPolicyWriteModel(pg,
      {kind:'query',schema,table,operation:'upsert'},'authenticated',global),null);
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
    auth:[{id:'user123',role:'admin',roleLevel:4,scopeIds:[],groupIds:[]},
      {id:'user123',role:'admin',roleLevel:4,scopeIds:[],groupIds:[]}]});
  await assert.rejects(()=>withFixedPolicyWrite(db,pg,body,'authenticated',
    {...claims,grants:['lo3rwang:manage']},dependencies,execute),
    /Global LOC policy permission required/);
  assert.equal(logged.execution,2,'a rejected write must not reach SQL');
});

test('all managed Registry, Galaxy, Anchor and Blocks updates derive primary keys without SQL',async()=>{
  const {modelNameForSql,modeledPrimaryKeyColumns}=await import('../zenstack/model-column-guard.mjs');
  const management=readFileSync(new URL('../app/loc/providers/kysely-management.mjs',import.meta.url),'utf8');
  const begin=management.indexOf('export function managedPrimaryKeyColumns(');
  const end=management.indexOf('\nasync function authorizeRelation(',begin);
  assert.ok(begin>0&&end>begin);
  const body=management.slice(begin,end).replace('export function','function');
  const helper=new Function('modelNameForSql','modeledPrimaryKeyColumns',
    'SCOPED_SUFFIXES','reject',body+'\nreturn managedPrimaryKeyColumns;')(
    modelNameForSql,modeledPrimaryKeyColumns,
    ['_galaxy','_anchor','_blocks'],m=>{throw new Error(m)});
  const cases=[
    ['manage','Manage','id'],['loc','Loc','id'],
    ['lo3rwang','','id'],['lrunes','','id'],
    ['loc_blocks','','uid'],['lo3rwang_galaxy','','uid'],
    ['lrunes_galaxy','','uid'],['lo3rwang_anchor','','uid'],
    ['lrunes_anchor','','uid'],['lo3rwang_blocks','','uid'],
    ['lrunes_blocks','','uid'],['loc_anchor','','uid'],
    ['lrunes_daily','','record_id'],
    ['demo_galaxy','','uid'],['demo_anchor','','uid'],
    ['demo_blocks','','uid'],['demo','','id']
  ];
  for(const [table,model,key] of cases)
    assert.deepEqual(helper(table,model),[key],table+' PK contract');
  assert.deepEqual(modeledPrimaryKeyColumns('silver','runes_etc'),
    ['rune_id','dir','type','current_moon'],'composite physical keys come from ZModel');
  assert.deepEqual(modeledPrimaryKeyColumns('silver','unknown_external_table'),null);
  assert.throws(()=>helper('manage','Loc'),/Invalid fixed LOC primary key metadata/);
  assert.throws(()=>helper('unknown_external_table','Manage'),
    /Invalid fixed LOC primary key metadata/);
  assert.doesNotMatch(management,/from pg_index/i,
    'no extra SQL catalog read is needed for a managed update');
  assert.match(management,/const keys=managedPrimaryKeyColumns\(table,modelName\)/);
});

test('LOC roles are projected from verified delegations, never from claimed role text',()=>{
  const principal=(grants,extra={})=>locRolePrincipal(
    {provider:'loc',me:true,sub:'alice',grants,role:'admin',...extra});
  assert.deepEqual(LOC_ROLE_LEVEL,{guest:0,user:1,scope:2,group:3,admin:4});
  const user=principal([]);
  assert.deepEqual(user,{id:'alice',role:'user',roleLevel:1,scopeIds:[],groupIds:[]});
  const scope=principal(['alpha:manage','beta:manage']);
  assert.deepEqual(scope,{id:'alice',role:'scope',roleLevel:2,
    scopeIds:['alpha','beta'],groupIds:[]});
  const admin=principal(['global:manage']);
  assert.deepEqual(admin,{id:'alice',role:'admin',roleLevel:4,
    scopeIds:[],groupIds:[]});
  assert.equal(principal(['alpha:read','beta:write']).role,'user');
  assert.equal(locRolePrincipal({provider:'clerk',me:true,sub:'alice',
    grants:['global:manage']}),null);
  assert.equal(locRolePrincipal({provider:'loc',me:false,sub:'alice',
    grants:['global:manage']}),null);
  assert.equal(locRolePrincipal({provider:'loc',me:true,sub:'',
    grants:['global:manage']}),null);
});

test('nested virtual Group grants expand downward, without creating Group users',()=>{
  const tree=[
    {scope_id:'org',scope_kind:'group'},
    {scope_id:'division',scope_kind:'group',parent_scope_id:'org'},
    {scope_id:'team',scope_kind:'group',parent_scope_id:'division'},
    {scope_id:'alpha',scope_kind:'scope',parent_scope_id:'team'},
    {scope_id:'beta',scope_kind:'scope',parent_scope_id:'division'},
    {scope_id:'other',scope_kind:'scope',parent_scope_id:'org'},
    {scope_id:'outside',scope_kind:'scope'},
    {scope_id:'paused',scope_kind:'scope',parent_scope_id:'team',active:false}
  ];
  const claims=grants=>({provider:'loc',me:true,sub:'director',grants});
  const division=locRolePrincipal(claims(['division:manage']),{scopeTree:tree});
  assert.equal(division.role,'group');
  assert.equal(division.roleLevel,3);
  assert.deepEqual(division.groupIds,['division','team']);
  assert.deepEqual(division.scopeIds,['alpha','beta']);
  assert.ok(!division.scopeIds.includes('other'));
  assert.ok(!division.scopeIds.includes('paused'));
  assert.deepEqual(locRolePrincipal(claims(['alpha:manage']),{scopeTree:tree}),{
    id:'director',role:'scope',roleLevel:2,scopeIds:['alpha'],groupIds:[]
  });
  const root=locRolePrincipal(claims(['org:manage']),{scopeTree:tree});
  assert.deepEqual(root.scopeIds,['alpha','beta','other']);
  assert.deepEqual(root.groupIds,['division','org','team']);
  assert.equal(root.role,'group','an entire organization still does not equal Admin');
  assert.equal(locRolePrincipal(claims(['division:manage'])).role,'scope',
    'without a trusted Group tree, the claim grants only its exact identifier');
  assert.equal(locRolePrincipal(claims(['division:manage','global:manage']),
    {scopeTree:tree}).role,'admin');
  assert.equal(locRolePrincipal(claims(['alpha:manage','beta:manage']),
    {scopeTree:tree}).role,'scope','multiple Scope grants do not imply Group');
});

test('virtual Group tree rejects cyclic or ambiguous hierarchy',()=>{
  const claims={provider:'loc',me:true,sub:'manager',grants:['a:manage']};
  assert.throws(()=>locRolePrincipal(claims,{scopeTree:[
    {scope_id:'a',scope_kind:'group',parent_scope_id:'b'},
    {scope_id:'b',scope_kind:'group',parent_scope_id:'a'}
  ]}),/Cyclic/);
  assert.throws(()=>locRolePrincipal(claims,{scopeTree:[
    {scope_id:'a',scope_kind:'group'},
    {scope_id:'a',scope_kind:'scope'}
  ]}),/Invalid/);
  const inactive=locRolePrincipal(claims,{scopeTree:[
    {scope_id:'a',scope_kind:'group',active:false},
    {scope_id:'b',scope_kind:'scope',parent_scope_id:'a'}
  ]});
  assert.deepEqual(inactive,{id:'manager',role:'user',roleLevel:1,
    scopeIds:[],groupIds:[]});
});
