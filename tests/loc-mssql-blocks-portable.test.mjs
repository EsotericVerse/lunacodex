import test from 'node:test';
import assert from 'node:assert/strict';
import {saveBlocksKysely} from '../app/loc/providers/kysely-blocks.mjs';

const block=(uid,order,title)=>({
  uid,block_order:order,block_title:title,
  block_eyebrow:'',block_subtitle:'',block_text:'Body',
  block_entity:[],block_image:null
});

function makeDb(existing,updatedRows=1n){
  const calls=[];
  const db={
    selectFrom(table){
      return {select:()=>({execute:async()=>{calls.push(['read',table]);return existing;}})};
    },
    insertInto(table){
      return {values:rows=>({
        execute:async()=>{calls.push(['insert',table,rows]);return [];}
      })};
    },
    updateTable(table){
      return {set:values=>{
        const predicates=[];
        return {
          where(...args){predicates.push(args);return this;},
          async executeTakeFirst(){
            calls.push(['update',table,values,predicates]);
            return {numUpdatedRows:updatedRows};
          }
        };
      }};
    },
    deleteFrom(table){
      const predicates=[];
      return {
        where(...args){predicates.push(args);return this;},
        async execute(){
          calls.push(['delete',table,predicates]);
          return [];
        }
      };
    }
  };
  return {db,calls};
}

test('SQL Server Block save groups new UIDs, guards existing UIDs, and deletes removed page rows',async()=>{
  const {db,calls}=makeDb([
    {uid:'AAAA0001',page_name:'home'},
    {uid:'AAAA0002',page_name:'home'},
    {uid:'CCCC0001',page_name:'other'}
  ]);
  const result=await saveBlocksKysely(db,{
    p_scope_id:'lo3rwang',p_type:'home',
    p_rows:[block('AAAA0001',1,'updated'),block('BBBB0001',2,'new')]
  },{engine:'mssql',namespace:'dbo'});
  assert.equal(result.count,2);
  assert.equal(result.removed,1);
  assert.equal(calls.filter(x=>x[0]==='read').length,1);
  const added=calls.find(x=>x[0]==='insert');
  assert.equal(added[1],'dbo.lo3rwang_blocks');
  assert.deepEqual(added[2].map(row=>row.uid),['BBBB0001']);
  assert.equal(added[2][0].block_entity,'[]');
  const changed=calls.find(x=>x[0]==='update');
  assert.equal(changed[2].block_title,'updated');
  assert.deepEqual(changed[3],[['uid','=','AAAA0001'],['page_name','=','home']]);
  const removed=calls.find(x=>x[0]==='delete');
  assert.ok(removed);
  assert.deepEqual(removed[2][0],['page_name','=','home']);
  assert.deepEqual(removed[2][1],['uid','in',['AAAA0002']]);
});

test('SQL Server Block save cannot overwrite an existing UID from another page',async()=>{
  const {db,calls}=makeDb([{uid:'AAAA0001',page_name:'other'}]);
  await assert.rejects(saveBlocksKysely(db,{
    p_scope_id:'lo3rwang',p_type:'home',p_rows:[block('AAAA0001',1,'foreign')]
  },{engine:'mssql',namespace:'dbo'}),/Block UID belongs to another page/);
  assert.equal(calls.filter(x=>x[0]!=='read').length,0);
});

test('SQL Server Block save treats a concurrent disappearance as conflict',async()=>{
  const {db,calls}=makeDb([{uid:'AAAA0001',page_name:'home'}],0n);
  await assert.rejects(saveBlocksKysely(db,{
    p_scope_id:'lo3rwang',p_type:'home',p_rows:[block('AAAA0001',1,'changed')]
  },{engine:'mssql',namespace:'dbo'}),error=>
    error?.httpStatus===409&&/Block changed/.test(error.message));
  assert.equal(calls.filter(x=>x[0]==='update').length,1);
});
