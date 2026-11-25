import test from 'node:test';
import assert from 'node:assert/strict';
import {withFixedPolicyRead,fixedPolicyReadModel}
  from '../packages/zenstack/policy-runtime.mjs';

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

test('lightweight reads preserve fixed-model and operation whitelist',async()=>{
  const db={},opts={
    dialect:{},
    ZenStackClient:class {constructor(){throw Error('must not construct denied client');}},
    PolicyPlugin:class {}
  };
  for(const [engine,body] of [
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
