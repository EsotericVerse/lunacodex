import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Kysely,PostgresDialect} from 'kysely';
import {planKyselyUpsertBatches,buildKyselyUpsertQuery}
  from '../app/loc/providers/kysely-runtime.mjs';
import {prepareManagedKyselyWrite}
  from '../app/loc/providers/kysely-management.mjs';
const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('UPSERT batches preserve order and split duplicate primary keys',()=>{
  const rows=[
    {uid:'AAAA0001',title:'one'}, {uid:'BBBB0002',title:'two'},
    {uid:'AAAA0001',title:'three'}, {uid:'CCCC0003',title:'four',content:'x'},
    {uid:'DDDD0004',title:'five',content:'y'}
  ];
  const batches=planKyselyUpsertBatches(rows,'uid');
  assert.deepEqual(batches.map(b=>b.map(row=>row.uid)),
    [['AAAA0001','BBBB0002'],['AAAA0001'],['CCCC0003','DDDD0004']]);
  assert.deepEqual(batches.flat(),rows);
});
test('UPSERT batches obey parameter and byte budgets',()=>{
  const rows=Array.from({length:11},(_,i)=>({uid:String(i).padStart(8,'0'),title:'some title'}));
  const batches=planKyselyUpsertBatches(rows,'uid',{maxParameters:6,maxBytes:1000});
  assert.ok(batches.every(batch=>batch.length<=3));
  assert.deepEqual(batches.flat(),rows);
  assert.ok(planKyselyUpsertBatches(rows,'uid',{maxBytes:30}).length>1);
});
test('Kysely native PG UPSERT uses row-specific EXCLUDED references',()=>{
  const db=new Kysely({dialect:new PostgresDialect({pool:{
    connect:async()=>{throw Error('Compile-only test must not connect');}
  }})});
  const query=buildKyselyUpsertQuery(db,{
    schema:'silver',table:'lo3rwang_galaxy',
    values:[{uid:'AAAA0001',title:'one'},{uid:'BBBB0002',title:'two'}],
    onConflict:['uid']
  },'postgres');
  const compiled=query.compile();
  assert.match(compiled.sql,/on conflict/i);
  assert.match(compiled.sql,/excluded.*title/i);
  assert.equal(compiled.parameters.length,4);
});
test('pure managed validation does not mutate the request payload',()=>{
  const input={kind:'managed-write',payload:{
    p_table:'silver.lo3rwang_galaxy',p_operation:'update',
    p_values:{title:'new title'},p_filters:[{column:'uid',operator:'eq',value:'AAAA0001'}]
  }};
  const plan=prepareManagedKyselyWrite(input);
  assert.notEqual(plan.values,input.payload.p_values);
  assert.deepEqual(input.payload.p_values,{title:'new title'});
  assert.equal(plan.table,'lo3rwang_galaxy');
  assert.throws(()=>prepareManagedKyselyWrite({payload:{
    p_table:'silver.lo3rwang_galaxy',p_operation:'delete',p_filters:[]
  }}),/filters|filter/i);
});
test('LOC validates writes before transaction and leaves grants on trx',()=>{
  const native=source('app/loc/mcp/native-operations.mjs');
  assert.ok(native.indexOf('const preparedWrites=')<native.indexOf("if(body.kind==='managed-transaction'){",
    native.indexOf('const preparedWrites=')));
  assert.match(native,/bindLocAuthorization\(trx/);
  assert.match(native,/transaction\(\)\.execute\(async trx=>/);
  const m=source('app/loc/providers/kysely-management.mjs');
  assert.match(m,/await authorizeRelation\(trx,table,operation/);
  assert.match(m,/\.forUpdate\(\)/);
});
