import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizeCrossEngineQuery,assertCrossEnginePublicRead,executeCrossEngineManagedWrite,
  serializePortableJsonFields} from '../app/loc/providers/sql-engine-ports.mjs';

const identity={role:'authenticated',
  claims:{sub:'user_AbC123',provider:'clerk',email:'owner@example.test'}};
const query=(table,operation='select')=>({kind:'query',schema:'silver',table,operation});
function registry(rows,{blacklist={email:[]}}={}){
  return {
    fn(name,columns){
      assert.equal(name,'lower');assert.deepEqual(columns,['email']);
      return 'lower(email)';
    },
    selectFrom(table){
      if(table==='silver.loc')return {select(field){
        assert.equal(field,'blacklist');
        return {where(column,op,value){
          assert.equal(column,'id');assert.equal(value,'loc');
          return {executeTakeFirst:async()=>({blacklist})};
        }};
      }};
      assert.equal(table,'silver.manage');
      return {select(fields){
        assert.deepEqual(fields,['id','email','manage_role','active']);
        return {where(column,op,value){
          assert.equal(column,'lower(email)');assert.equal(op,'=');
          assert.equal(value,'owner@example.test');
          return {execute:async()=>rows};
        }};
      }};
    }
  };
}

test('public engine reads only reference tables; private Galaxy remains private',async()=>{
  assertCrossEnginePublicRead(query('runes'));
  await assert.rejects(authorizeCrossEngineQuery(registry([]),query('lo3rwang_galaxy')),
    /authorization adapter/);
  await assert.rejects(authorizeCrossEngineQuery(registry([]),query('runes','delete')),
    /authorization adapter/);
});
test('verified LOC Scope owner can use generic native Kysely SELECT and writes',async()=>{
  const db=registry([{id:'lo3rwang',email:'owner@example.test',
    manage_role:'scope',active:true}]);
  for(const [table,operation] of [['lo3rwang_galaxy','select'],['lo3rwang_anchor','insert'],
    ['lo3rwang_blocks','update'],['lo3rwang','select']]){
    await authorizeCrossEngineQuery(db,query(table,operation),identity);
  }
});
test('Scope owner cannot mutate registry, global settings, or other Scope',async()=>{
  const db=registry([{id:'lo3rwang',email:'owner@example.test',
    manage_role:'scope',active:true}]);
  for(const table of ['manage','loc','lrunes_galaxy','unknown_table']){
    await assert.rejects(authorizeCrossEngineQuery(db,query(table,'update'),identity),
      /permission denied/);
  }
});
test('inactive Scope grants are denied and forged unsigned identity is denied',async()=>{
  const db=registry([{id:'lo3rwang',email:'owner@example.test',
    manage_role:'scope',active:false}]);
  await assert.rejects(authorizeCrossEngineQuery(db,query('lo3rwang_galaxy','insert'),identity),
    /permission denied/);
  await assert.rejects(authorizeCrossEngineQuery(db,query('lo3rwang_galaxy','insert'),
    {role:'authenticated',claims:{email:'owner@example.test'}}),
    /Verified Clerk identity/);
});
test('signed root administration can update all LOC Scope relations',async()=>{
  const db=registry([{id:'admin',email:'owner@example.test',
    manage_role:'admin',active:true}]);
  for(const table of ['manage','loc','lrunes_anchor']){
    await authorizeCrossEngineQuery(db,query(table,'update'),identity);
  }
});
test('cross-engine ACL has no RPC or raw SQL bypass',async()=>{
  await assert.rejects(authorizeCrossEngineQuery(registry([]),{
    kind:'rpc',schema:'silver',name:'management_write'},identity),/Unsupported cross-engine/);
});

test('portable managed inserts are 50-row Kysely batches; Scope ACL still applies',async()=>{
  const sizes=[];
  const db={
    ...registry([{id:'lo3rwang',email:'owner@example.test',
      manage_role:'scope',active:true}]),
    insertInto:()=>({values(rows){return {executeTakeFirst:async()=>{
      sizes.push(rows.length);
      return {numInsertedOrUpdatedRows:BigInt(rows.length)};
    }};}})
  };
  const rows=Array.from({length:120},(_,i)=>({uid:String(i).padStart(8,'0'),title:'row'}));
  const result=await executeCrossEngineManagedWrite(db,{
    payload:{p_table:'silver.lo3rwang_galaxy',p_operation:'insert',p_rows:rows}
  },identity);
  assert.deepEqual(sizes,[50,50,20]);
  assert.equal(result.data.count,120);
  await assert.rejects(executeCrossEngineManagedWrite(db,{
    payload:{p_table:'silver.lrunes_galaxy',p_operation:'insert',p_rows:rows.slice(0,1)}
  },identity),/permission denied/);
});

test('portable JSON values are serialized without touching lyrics or PostgreSQL arrays',()=>{
  const row={attr:{date:'2026-11-04'},media_link:['Ab12Cd34'],
    content:'{"not":"a database object"}',title:'hello'};
  const converted=serializePortableJsonFields(row,'mssql');
  assert.equal(converted.attr,'{"date":"2026-11-04"}');
  assert.equal(converted.media_link,'["Ab12Cd34"]');
  assert.equal(converted.content,row.content);
  assert.deepEqual(serializePortableJsonFields(row,'postgres'),row);
});

test('blacklisted Clerk identities cannot access external SQL even with admin rights',async()=>{
  const db=registry([{id:'admin',email:'owner@example.test',
    manage_role:'admin',active:false}],{blacklist:{email:[{email:'OWNER@example.test'}]}});
  await assert.rejects(authorizeCrossEngineQuery(db,query('lo3rwang_galaxy'),identity),
    /identity is blocked/);
});
test('cross-engine authorization fails closed without readable LOC policy',async()=>{
  const db=registry([{id:'admin',email:'owner@example.test',
    manage_role:'admin',active:false}],{blacklist:null});
  await assert.rejects(authorizeCrossEngineQuery(db,query('lo3rwang_galaxy'),identity),
    /authorization configuration unavailable/);
});

test('SQL Server wide inserts stay below the 2,100-parameter statement cap',async()=>{
  const sizes=[],widths=[];
  const db={
    ...registry([{id:'lo3rwang',email:'owner@example.test',
      manage_role:'scope',active:true}]),
    insertInto:()=>({values(batch){return {executeTakeFirst:async()=>{
      sizes.push(batch.length);
      widths.push(Object.keys(batch[0]).length);
      assert.ok(batch.length*Object.keys(batch[0]).length<=2000);
      return {numInsertedOrUpdatedRows:BigInt(batch.length)};
    }};}})
  };
  const rows=Array.from({length:80},(_,i)=>Object.fromEntries([
    ['uid',String(i).padStart(8,'0')],
    ...Array.from({length:59},(_,j)=>['field_'+j,'value'])
  ]));
  const result=await executeCrossEngineManagedWrite(db,{
    payload:{p_table:'silver.lo3rwang_galaxy',p_operation:'insert',p_rows:rows}
  },{...identity,engine:'mssql',namespace:'dbo'});
  assert.deepEqual(sizes,[33,33,14]);
  assert.deepEqual(widths,[60,60,60]);
  assert.equal(result.data.count,80);
});

test('MySQL retains 50-row batches regardless of the SQL Server width limit',async()=>{
  const sizes=[];
  const db={
    ...registry([{id:'lo3rwang',email:'owner@example.test',
      manage_role:'scope',active:true}]),
    insertInto:()=>({values(rows){return {executeTakeFirst:async()=>{
      sizes.push(rows.length);
      return {numInsertedOrUpdatedRows:BigInt(rows.length)};
    }};}})
  };
  const rows=Array.from({length:70},(_,i)=>Object.fromEntries([
    ['uid',String(i).padStart(8,'0')],
    ...Array.from({length:59},(_,j)=>['field_'+j,'value'])
  ]));
  const result=await executeCrossEngineManagedWrite(db,{
    payload:{p_table:'silver.lo3rwang_galaxy',p_operation:'insert',p_rows:rows}
  },{...identity,engine:'mysql',namespace:''});
  assert.deepEqual(sizes,[50,20]);
  assert.equal(result.data.count,70);
});
