import test from 'node:test';
import assert from 'node:assert/strict';
import {saveBlocksKysely} from '../app/loc/providers/kysely-blocks.mjs';
import {block_list} from '../app/loc/providers/kysely-public.mjs';
import {publicScopeBlockPage} from '../app/loc/blocks/public-scope-pages.mjs';

{
function mockBlocks(rows){
  const calls=[];
  const trx={
    selectFrom(table){
      calls.push(['from',table]);
      return {
        select(columns){
          calls.push(['select',columns]);
          return {
            where(column,operator,value){
              calls.push(['where',column,operator,value]);
              return {
                orderBy(key,direction){
                  calls.push(['orderBy',key,direction]);
                  return {
                    execute:async()=>rows.filter(row=>row.page_name===value)
                  };
                }
              };
            }
          };
        }
      };
    }
  };
  return {trx,calls};
}

test('only guest-visible public Scope Block pages may be read',()=>{
  for(const page of ['index','search','trace','hero','game','culture','statics'])
    assert.equal(publicScopeBlockPage(page),page);
  for(const page of ['manage','scope_manage','admin','setting','internal','scope_admin',''])
    assert.equal(publicScopeBlockPage(page),null);
});

test('block_list keeps legacy homepage default and rejects management pages',async()=>{
  const {trx,calls}=mockBlocks([{uid:'INDEX001',page_name:'index',block_order:1}]);
  const rows=await block_list(trx,'lo3rwang');
  assert.deepEqual(rows.map(row=>row.uid),['INDEX001']);
  assert.equal(calls.find(row=>row[0]==='where')[3],'index');
  await assert.rejects(()=>block_list(trx,'lo3rwang',{pageName:'scope_manage'}),
    /Invalid public Scope Block page/);
  await assert.rejects(()=>block_list(trx,'loc',{pageName:'search'}),
    /Invalid LOC public Block page/);
});

}

{
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
}
