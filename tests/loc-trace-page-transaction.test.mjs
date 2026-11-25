import {planUidDependencyRepair} from '../app/loc/providers/uid-dependency-immer.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {saveTracePageInTransaction}
  from '../app/loc/providers/kysely-trace-page.mjs';

const VALID=['ABCD1234','EFGH5678','IJKL9012'];
function fakeWrites(affected=ids=>ids.length){
  const events=[];
  const trx={
    updateTable(table){
      assert.equal(table,'silver.lo3rwang_anchor');
      let value,ids=[],type='';
      const query={
        set(values){value=values;return this;},
        where(column,op,input){
          if(column==='uid')ids=Array.isArray(input)?input:[input];
          if(column==='type')type=input;
          return this;
        },
        async executeTakeFirst(){
          events.push({type,ids,value});
          return {numUpdatedRows:BigInt(affected(ids))};
        }
      };
      return query;
    }
  };
  return {trx,events};
}
test('Trace title groups and visibility are submitted under the same transaction object',async()=>{
  const {trx,events}=fakeWrites();
  const result=await saveTracePageInTransaction(trx,'lo3rwang',{
    p_renames:[{uids:VALID.slice(0,2),title:'正確位置'}],
    p_visibility:{uids:[VALID[2]],invisible:true}
  },()=>assert.fail('No merge requested'));
  assert.deepEqual([result.renamed_count,result.visibility_count],[2,1]);
  assert.deepEqual(events.map(e=>e.type),['point','point']);
  assert.deepEqual(events.map(e=>e.ids),[VALID.slice(0,2),[VALID[2]]]);
  assert.deepEqual(events.map(e=>e.value),[
    {title:'正確位置'},{invisible:true}
  ]);
});
test('Trace partial updates stop the Save before subsequent SQL writes',async()=>{
  const {trx,events}=fakeWrites(ids=>ids.length-1);
  await assert.rejects(saveTracePageInTransaction(trx,'lo3rwang',{
    p_renames:[{uids:VALID.slice(0,2),title:'完整更新'}],
    p_visibility:{uids:[VALID[2]],invisible:true}
  },()=>assert.fail('No merge requested')),error=>
    error.httpStatus===409&&/affected-row mismatch/.test(error.message));
  assert.equal(events.length,1);
});
test('Trace merge is invoked once with the verified SQL transaction, never as another HTTP RPC',async()=>{
  const trx={};
  const result=await saveTracePageInTransaction(trx,'lo3rwang',{
    p_keep_uid:VALID[0],p_merge_uids:[VALID[1],VALID[2]]
  },async args=>{
    assert.deepEqual(args,{p_scope_id:'lo3rwang',p_keep_uid:VALID[0],
      p_remove_uids:[VALID[1],VALID[2]]});
    return 2;
  });
  assert.equal(result.merged_count,2);
  assert.equal(result.uid,VALID[0]);
});
test('Trace page fails closed before writing malformed/duplicated UIDs',async()=>{
  const {trx,events}=fakeWrites();
  await assert.rejects(saveTracePageInTransaction(trx,'lo3rwang',{
    p_renames:[{uids:[VALID[0],VALID[0]],title:'X'}]
  },()=>0),/UID list is invalid/);
  assert.deepEqual(events,[]);
});


test('Trace segment repair keeps endpoint pairs and anchor count',()=>{
  const plan=planUidDependencyRepair({deletedUid:'POIN0002',
    deletedTable:'anchor',deletedType:'point',anchorRows:[{
      uid:'TRAC0001',type:'trace',
      attr:{point:['POIN0001','POIN0002','POIN0003','POIN0004'],path:[]}
    }]});
  assert.equal(plan.anchorUpdates.length,1);
  assert.deepEqual(plan.anchorUpdates[0].values.attr.point,['POIN0003','POIN0004']);
  assert.equal(plan.anchorUpdates[0].values.num,2n);
  assert.deepEqual(plan.anchorUpdates[0].expected.attr.point,
    ['POIN0001','POIN0002','POIN0003','POIN0004']);
});
