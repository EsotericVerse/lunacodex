import test from 'node:test';
import assert from 'node:assert/strict';
import {parseGalaxyFeatureTransaction,executeGalaxyFeatureTransaction,
  GALAXY_FEATURE_MODELS} from '../app/loc/model/galaxy-feature-transactions.mjs';
import {handleNamedPublicTransaction} from '../app/loc/server/public-named-transactions.mjs';

const base={kind:'transaction',operation:'galaxy-feature',scope:'lo3rwang',
  feature:'culture',startDate:'2026-01-01',endDate:'2026-12-31',result:'uids'};
const request=body=>new Request('https://loc.lo3rwang.cc/api/loc-public-query',{
  method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify(body)});

test('four fixed Galaxy feature flags match the ZModel contracts',()=>{
  assert.deepEqual(Object.keys(GALAXY_FEATURE_MODELS),['culture','statics','search','trace']);
  assert.equal(GALAXY_FEATURE_MODELS.statics.flag,'statics');
});
test('no arbitrary SQL, relation, column or filter passes the transaction boundary',async()=>{
  for(const extra of [
    {sql:'DELETE FROM silver.lo3rwang_galaxy'},
    {table:'api.manage'},{columns:['email']},{filters:[]},
    {feature:'other'},{scope:'admin'},{scope:'loc'},
    {startDate:'2026-02-30'},{startDate:'2026-12-31',endDate:'2026-01-01'},
    {category:{type:'source',value:'vocus',sql:'SELECT'}},
    {category:{type:'place',value:'invalid'}},{limit:101},
    {result:'count',cursor:'AAAA0001'}
  ]){
    assert.throws(()=>parseGalaxyFeatureTransaction({...base,...extra}));
    const response=await handleNamedPublicTransaction(request({...base,...extra}),{},
      {database:()=>{throw Error('SQL must not start')}});
    assert.equal(response.status,400);
  }
});
test('UID list defaults to 100 and rejects larger limits',()=>{
  assert.equal(parseGalaxyFeatureTransaction(base).limit,100);
  assert.equal(parseGalaxyFeatureTransaction({...base,limit:5}).limit,5);
});
test('one feature transaction includes audited request model and scope',async()=>{
  const observed={tables:[],filters:[],levels:[],transactions:0};
  const query={where(...args){observed.filters.push(args);return this},
    select(){return this},orderBy(){return this},limit(){return this},
    async execute(){return [{uid:'AAAA0001'}]}};
  const trx={selectFrom(table){observed.tables.push(table);return query}};
  const db={transaction(){observed.transactions++;return {
    setIsolationLevel(level){observed.levels.push(level);return this},
    execute(fn){return fn(trx)}
  }},async destroy(){}};
  const response=await handleNamedPublicTransaction(request({
    ...base,feature:'trace',category:{type:'place',value:'BBBB0001'}
  }),{},{database:async()=>({engine:'postgres',db,pool:{end:async()=>{}}})});
  assert.equal(response.status,200);
  const payload=await response.json();
  assert.deepEqual(payload.data.uids,['AAAA0001']);
  assert.equal(payload.transaction.requestedBy,'trace');
  assert.equal(payload.transaction.model,'GalaxyTrace');
  assert.deepEqual(observed.tables,['silver.lo3rwang_galaxy']);
  assert.ok(observed.filters.some(args=>args[0]==='trace'&&args[2]===true));
  assert.ok(observed.filters.some(args=>args[0]==='place_id'&&args[2]==='BBBB0001'));
  assert.deepEqual(observed.levels,['repeatable read']);
  assert.equal(observed.transactions,1);
});
