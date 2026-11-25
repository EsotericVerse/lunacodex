import test from 'node:test';
import assert from 'node:assert/strict';
import {withFixedPolicyRead,fixedPolicyReadModel}
  from '../packages/zenstack/policy-runtime.mjs';

{
const model=id=>({kind:'query',schema:'silver',table:id,operation:'select'});

// Verify the authorized ORM delegate is used DIRECTLY. These mocks reject
// an explicit transaction and never open any SQL connection.
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
