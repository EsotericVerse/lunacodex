import test from 'node:test';
import assert from 'node:assert/strict';
import {executeLocConversation} from '../app/loc/mcp/conversations.mjs';
import {resolveLocPermissions} from '../app/loc/permissions/roles.mjs';

function memoryDb(){
  const rows=[];
  const relation='silver.lo3rwang_galaxy';
  const builder=(kind,table)=>{
    assert.equal(table,relation);
    const conditions=[];
    let change=null;
    let payload=null;
    const q={
      select(){return q},
      orderBy(){return q},
      limit(){return q},
      where(column,operator,value){
        conditions.push(row=>operator==='is'?row[column]==null:
          operator==='='?row[column]===value:
          (()=>{throw Error('unsupported operator '+operator)})());
        return q;
      },
      set(value){change=value;return q},
      values(value){payload=value;return q},
      async executeTakeFirst(){
        const match=rows.find(row=>conditions.every(fn=>fn(row)));
        if(kind==='select')return match||undefined;
        if(kind==='insert'){
          if(rows.some(row=>row.uid===payload.uid)){
            throw Object.assign(Error('Duplicate UID'),{code:'23505'});
          }
          rows.push({...payload});
          return {numInsertedOrUpdatedRows:1n};
        }
        if(kind==='update'&&match){
          Object.assign(match,change);
          return {numUpdatedRows:1n};
        }
        return {numUpdatedRows:0n};
      }
    };
    return q;
  };
  return {rows,
    selectFrom:table=>builder('select',table),
    insertInto:table=>builder('insert',table),
    updateTable:table=>builder('update',table)
  };
}
const actor={provider:'loc',me:true,
  grants:['lo3rwang:read','lo3rwang:write']};
const base={action:'record',scopeid:'lo3rwang',
  conversation_id:'conversation-test-id',updated_at:'2026-11-11T01:00:00.000Z',
  title:'Conversation',
  records:[{role:'user',kind:'original',sent_at:'2026-11-11T00:59:00.000Z',
    message_id:'m1',text:'Test original conversation evidence'}]
};
test('LOC real business writer contract: record, persisted receipt, idempotent replay, append, read/check',async()=>{
  const db=memoryDb();
  const first=await executeLocConversation(db,base,actor);
  assert.equal(first.accepted,true);
  assert.match(first.uid,/^[A-Za-z0-9]{8}$/);
  assert.equal(db.rows.length,1);
  assert.equal(db.rows[0].site,'mcp');
  assert.equal(db.rows[0].culture,false);
  assert.equal(db.rows[0].statics,false);
  assert.match(db.rows[0].content,/Test original conversation evidence/);
  const check=await executeLocConversation(db,{action:'check',scopeid:'lo3rwang',
    conversation_id:base.conversation_id,updated_at:base.updated_at},actor);
  assert.equal(check.found,true);
  assert.equal(check.needs_sync,false);
  assert.equal(check.uid,first.uid);
  const duplicate=await executeLocConversation(db,base,actor);
  assert.equal(duplicate.duplicate,true);
  assert.equal(db.rows.length,1);
  const second={...base,updated_at:'2026-11-11T01:02:00.000Z',
    records:[{role:'assistant',kind:'advice',message_id:'m2',
      sent_at:'2026-11-11T01:02:00.000Z',text:'Subsequent genuine advice'}]};
  const after=await executeLocConversation(db,second,actor);
  assert.equal(after.accepted,true);
  assert.equal(after.uid,first.uid);
  assert.equal(db.rows.length,1);
  assert.match(db.rows[0].content,/Subsequent genuine advice/);
});
test('business writing denies anonymous, unrelated user, and missing Scope',async()=>{
  const db=memoryDb();
  await assert.rejects(executeLocConversation(db,base,{...actor,grants:[],me:false}),
    /business permission/);
  await assert.rejects(executeLocConversation(db,base,{...actor,grants:['lrunes:write']}),
    /business permission/);
  assert.equal(db.rows.length,0);
});
test('no GitHub/PR records may masquerade as private conversations',async()=>{
  const db=memoryDb();
  await assert.rejects(executeLocConversation(db,{...base,
    conversation_id:'https://github.com/demo/repo/pull/123'},actor),/GitHub conversation/);
});
test('api.manage business role resolution never grants a different OAuth email',()=>{
  const rows=[{id:'lo3rwang',email:'sopa2306@gmail.com',
    active:true,manage_role:'admin'}];
  assert.equal(resolveLocPermissions('someone@example.org',rows).canWrite,false);
  const owner=resolveLocPermissions('sopa2306@gmail.com',rows);
  assert.equal(owner.canWrite,true);
  assert.ok(owner.grants.includes('global:manage'));
});
