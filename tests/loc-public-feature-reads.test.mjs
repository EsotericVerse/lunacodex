import test from 'node:test';
import assert from 'node:assert/strict';
import {withFixedPolicyRead,fixedPolicyReadModel}
  from '../packages/zenstack/policy-runtime.mjs';
import {handleNamedPublicTransaction} from '../app/loc/server/public-named-transactions.mjs';

const origin='https://loc.lo3rwang.cc';
const req=(body,path='/search/query')=>new Request(origin+path,{
  method:'POST',headers:{origin,'content-type':'application/json'},
  body:JSON.stringify(body)});
const forbid=()=>{throw Error('Rejected contract must not open database')};

test('feature read rejects generic SQL and retired bootstrap requests before connecting',async()=>{
  for(const body of [
    {schema:'silver',table:'lo3rwang_galaxy',columns:['*'],filters:[]},
    {kind:'transaction',operation:'query',sql:'select * from api.manage'},
    {kind:'transaction',operation:'action',name:'read_app_bootstrap',args:{}}
  ]){
    const response=await handleNamedPublicTransaction(req(body),{},{database:forbid});
    assert.equal(response.status,400);
  }
});

test('MySQL and MSSQL public analytics query directly without a SQL transaction',async()=>{
  for(const engine of ['mysql','mssql']){
    const observed={begins:0,queries:[],introspections:0};
    const namespace=engine==='mysql'?'locdb':'dbo';
    const db={
      introspection:{async getTables(){
        observed.introspections++;
        return ['lo3rwang_galaxy','lrunes_galaxy'].map(name=>({name,schema:namespace}));
      }},
      selectFrom(table){
        observed.queries.push(table);
        return {
          select(){return this},
          async executeTakeFirst(){
            return {article_count:2,word_count:20,
              first_date:'2026-01-01',last_date:'2026-11-22'};
          }
        };
      },
      transaction(){observed.begins++;throw Error('Read query opened a transaction')},
      async destroy(){}
    };
    const database=async()=>({
      engine,namespace,
      db,
      pool:{async end(){}}
    });
    const response=await handleNamedPublicTransaction(req({
      kind:'transaction',operation:'analytics',args:{
        p_scope_id:'loc',p_view:'search_summary',
        p_options:{scopeIds:['lo3rwang','lrunes']}
      }
    }),{},{database});
    assert.equal(response.status,200,engine);
    const result=await response.json();
    assert.equal(result.data.rows.length,2,engine);
    assert.equal(observed.begins,0,engine);
    assert.equal(observed.introspections,1,engine);
    assert.equal(observed.queries.length,2,engine);
  }
});

test('MySQL and MSSQL public Blocks actions query directly without a SQL transaction',async()=>{
  for(const engine of ['mysql','mssql']){
    const observed={transactions:0,tables:[]};
    const query={
      select(){return this},where(){return this},orderBy(){return this},
      async execute(){return []}
    };
    const database=async()=>({
      engine,namespace:engine==='mysql'?'locdb':'dbo',
      db:{selectFrom(table){observed.tables.push(table);return query},
        transaction(){observed.transactions++;throw Error('Read query opened a transaction')},
        async destroy(){}},
      pool:{async end(){}}
    });
    const response=await handleNamedPublicTransaction(req({
      kind:'transaction',operation:'action',
      name:'block_list',args:{p_scope_id:'lo3rwang'}
    }),{},{database});
    assert.equal(response.status,200,engine);
    assert.deepEqual((await response.json()).data,[]);
    assert.equal(observed.transactions,0,engine);
    assert.equal(observed.tables.length,1,engine);
  }
});

{
const model=id=>({kind:'query',schema:'silver',table:id,operation:'select'});

// Verify the authorized ORM delegate is used DIRECTLY. These mocks reject
// an explicit transaction and never open any SQL connection.
test('lightweight fixed Config, Hero and Blocks use one policy delegate without a transaction',async()=>{
  const calls=[];
  const db={};
  const dialect={trusted:true};
  class Policy {
    constructor(options){calls.push(['policy',options]);}
  }
  class Client {
    constructor(_schema,options){
      assert.equal(options.dialect,dialect);
      calls.push(['client']);
    }
    $use(plugin){
      assert.ok(plugin instanceof Policy);
      return {
        $setAuth(principal){
          calls.push(['auth',principal]);
          return {
            loc:{findFirst:async args=>{calls.push(['config',args]);return {id:'loc'};}},
            locAnchor:{findMany:async args=>{
              calls.push(['hero',args]);return [{uid:'HERO0001'}];
            }},
            lo3rwangBlocks:{findMany:async args=>{
              calls.push(['blocks',args]);return [{uid:'BLOC0001'}];
            }},
            $transaction(){throw new Error('An explicit read transaction was opened');}
          };
        },
        $transaction(){throw new Error('An explicit read transaction was opened');}
      };
    }
  }
  const inject={dialect,ZenStackClient:Client,PolicyPlugin:Policy};
  const cases=[
    ['loc','Loc','findFirst',{where:{id:'loc'},select:{id:true}},'id','loc'],
    ['loc_anchor','LocAnchor','findMany',
      {where:{type:{in:['hero']},invisible:false},select:{uid:true}},'uid','HERO0001'],
    ['lo3rwang_blocks','Lo3rwangBlocks','findMany',
      {where:{page_name:'index'},select:{uid:true}},'uid','BLOC0001']
  ];
  for(const [table,expected,method,args,field,value] of cases){
    const result=await withFixedPolicyRead(db,{engine:'postgres'},model(table),
      'anon',{},inject,(name,authorized)=>{
        assert.equal(name,expected);
        const delegate=authorized[name[0].toLowerCase()+name.slice(1)];
        return delegate[method](args);
      });
    assert.equal(Array.isArray(result)?result[0][field]:result[field],value);
  }
  assert.equal(calls.filter(([name])=>name==='client').length,1);
  assert.equal(calls.filter(([name])=>name==='policy').length,1);
  assert.equal(calls.filter(([name])=>name==='auth').length,3);
  assert.ok(calls.filter(([name])=>name==='auth').every(([,auth])=>auth===undefined));
  assert.deepEqual(calls.filter(([name])=>['config','hero','blocks'].includes(name))
    .map(([name])=>name),['config','hero','blocks']);
});

test('lightweight reads preserve fixed-model, engine and operation whitelist',async()=>{
  const db={},opts={
    dialect:{},
    ZenStackClient:class {constructor(){throw Error('must not construct denied client');}},
    PolicyPlugin:class {}
  };
  for(const [engine,body] of [
    ['mysql',model('loc')],
    ['postgres',model('lo3rwang_galaxy')],
    ['postgres',{...model('loc'),operation:'update'}],
    ['postgres',{...model('loc'),schema:'api'}]
  ]){
    assert.equal(fixedPolicyReadModel({engine},body),null);
    await assert.rejects(
      withFixedPolicyRead(db,{engine},body,'anon',{},opts,()=>null),
      /Not a fixed public ZModel policy query/
    );
  }
});
}
