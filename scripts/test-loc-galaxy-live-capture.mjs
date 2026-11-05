import {test} from 'node:test';
import assert from 'node:assert/strict';
import {captureController} from '../extensions/loc-galaxy/capture-manager.mjs';

test('opt-in capture deduplicates queue, retains failed writes, then checkpoints success',async()=>{
  const original=globalThis.chrome;
  const storage={'locGalaxy.scopeid':'lo3rwang'};
  const chrome={
    runtime:{id:'loc-extension-test'},
    permissions:{contains:async()=>true},
    scripting:{unregisterContentScripts:async()=>{},registerContentScripts:async()=>{},executeScript:async()=>{}},
    tabs:{query:async()=>[],sendMessage:async()=>{}},
    alarms:{create:async()=>{},clear:async()=>{}},
    storage:{local:{
      get:async keys=>Object.fromEntries(
        (Array.isArray(keys)?keys:[keys]).map(key=>[key,storage[key]])),
      set:async data=>Object.assign(storage,data),
      remove:async key=>{delete storage[key];}
    }}
  };
  globalThis.chrome=chrome;
  let attempts=0,recorded;
  try{
    const controller=captureController({
      authorized:async()=>({ready:true}),
      record:async payload=>{
        attempts++;
        recorded=payload;
        if(attempts===1)throw Error('network failed');
        return {saved:true,uid:'Ab12Cd34'};
      }
    });
    await controller.enable();
    const conversationId='chatgpt:123e4567-e89b-12d3-a456-426614174000';
    const msg={conversation_id:conversationId,
      message_id:'123e4567-e89b-12d3-a456-426614174111',
      observed_at:new Date().toISOString(),text:'原始使用者訊息'};
    const sender={id:chrome.runtime.id,tab:{id:7},
      url:'https://chatgpt.com/c/123e4567-e89b-12d3-a456-426614174000'};
    assert.equal((await controller.accept(msg,sender)).queued,true);
    assert.equal((await controller.accept(msg,sender)).queued,false);
    assert.equal((await controller.status()).pending,1);
    await assert.rejects(controller.accept(msg,{...sender,url:'https://example.com/c/'+msg.message_id}));
    await assert.rejects(controller.sync(),/network failed/);
    assert.equal((await controller.status()).pending,1);
    const done=await controller.sync();
    assert.equal(done.completed,1);
    assert.equal(done.syncing,false);
    assert.equal((await controller.status()).pending,0);
    assert.equal(attempts,2);
    assert.equal(recorded.conversation.records[0].text,msg.text);
    assert.equal(recorded.conversation.records[0].sent_at,msg.observed_at);
    await controller.disable();
    assert.equal((await controller.status()).enabled,false);
  }finally{
    globalThis.chrome=original;
  }
});
