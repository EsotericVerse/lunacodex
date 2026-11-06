import {test} from 'node:test';
import assert from 'node:assert/strict';
import {captureController} from '../extensions/loc-galaxy/capture-manager.mjs';
import {extractOpenConversation} from '../extensions/loc-galaxy/history-extract.mjs';

test('explicit history archive keeps user and assistant source text, avoids duplicate re-archive',async()=>{
  const original=globalThis.chrome;
  const local={'locGalaxy.scopeid':'lo3rwang'};
  const conversation_id='chatgpt:123e4567-e89b-12d3-a456-426614174000';
  const snapshot={conversation_id,records:[
    {role:'user',kind:'original',message_id:'123e4567-e89b-12d3-a456-426614174111',text:'原始問題'},
    {role:'assistant',kind:'advice',message_id:'123e4567-e89b-12d3-a456-426614174222',text:'原始回應'}
  ],partial:false};
  globalThis.chrome={
    runtime:{id:'extension'},
    permissions:{contains:async()=>true},
    scripting:{executeScript:async ({func})=>{
      assert.equal(func,extractOpenConversation);
      return [{result:snapshot}];
    }},
    tabs:{query:async()=>[{id:9,url:'https://chatgpt.com/c/'+conversation_id.slice(8)}]},
    storage:{local:{
      get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(key=>[key,local[key]])),
      set:async data=>Object.assign(local,data),
      remove:async keys=>(Array.isArray(keys)?keys:[keys]).forEach(key=>delete local[key])
    }}
  };
  const sent=[];
  try{
    const capture=captureController({
      authorized:async()=>({ready:true,scopeid:'lo3rwang'}),
      record:async payload=>{sent.push(payload.conversation);return {saved:true};}
    });
    const first=await capture.archiveActive();
    assert.equal(first.queued,2);
    assert.equal((await capture.sync()).completed,2);
    assert.deepEqual(sent[0].records.map(item=>item.role),['user','assistant']);
    assert.deepEqual(sent[0].records.map(item=>item.kind),['original','advice']);
    assert.deepEqual(sent[0].records.map(item=>item.text),['原始問題','原始回應']);
    assert.equal((await capture.archiveActive()).queued,0);
    assert.equal((await capture.status()).pending,0);
  }finally{globalThis.chrome=original;}
});


test('modern ChatGPT conversation-turn containers are imported without data-message-id',async()=>{
  const beforeDoc=globalThis.document,beforeLocation=globalThis.location;
  function turn(index,role,text){
    const content={innerText:text};
    const roleNode={getAttribute:name=>name==='data-message-author-role'?role:null,
      querySelector:selector=>selector==='.markdown'?content:null};
    return {parentElement:null,matches:selector=>selector==='[data-testid^="conversation-turn-"]',
      closest:()=>null,getAttribute:name=>name==='data-testid'?'conversation-turn-'+index:null,
      querySelector:selector=>selector==='[data-message-author-role]'?roleNode:null};
  }
  const rows=[turn(0,'user','幫我封存'),turn(1,'assistant','已準備封存')];
  globalThis.location={origin:'https://chatgpt.com',pathname:'/c/123e4567-e89b-12d3-a456-426614174000'};
  globalThis.document={
    body:{},documentElement:{},scrollingElement:null,
    querySelectorAll:selector=>selector==='[data-testid^="conversation-turn-"]'?rows:
      selector==='[data-message-id]'?[]:rows,
    querySelector:selector=>selector.includes('conversation-turn')?rows[0]:null
  };
  try{
    const result=await extractOpenConversation();
    assert.equal(result.captured_count,2);
    assert.deepEqual(result.records.map(x=>x.role),['user','assistant']);
    assert.deepEqual(result.records.map(x=>x.text),['幫我封存','已準備封存']);
    assert.deepEqual(result.records.map(x=>x.message_id),['turn-00000000','turn-00000001']);
  }finally{globalThis.document=beforeDoc;globalThis.location=beforeLocation;}
});

test('a rendered chat without recognized turns reports an explicit diagnostic instead of success=0',async()=>{
  const beforeDoc=globalThis.document,beforeLocation=globalThis.location;
  globalThis.location={origin:'https://chatgpt.com',pathname:'/c/123e4567-e89b-12d3-a456-426614174000'};
  globalThis.document={
    body:{},documentElement:{},scrollingElement:null,
    querySelectorAll:()=>[],querySelector:()=>null
  };
  try{
    await assert.rejects(()=>extractOpenConversation(),/不要將掃描 0 則當成匯入完成/);
  }finally{globalThis.document=beforeDoc;globalThis.location=beforeLocation;}
});
