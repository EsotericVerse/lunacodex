import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateConversation} from '../extensions/loc-galaxy/recorder.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const example=()=>({
  conversation_id:'chat:123',
  updated_at:'2026-11-06T04:00:00+08:00',
  records:[{role:'user',kind:'original',sent_at:'2026-11-06T03:59:00+08:00',
    message_id:'message:1',text:'原始對話'}]
});
test('Recorder accepts exact user originals without altering text',()=>{
  assert.deepEqual(validateConversation(example()),example());
});
test('Recorder accepts explicitly selected assistant advice',()=>{
  const e=example();
  e.records.push({role:'assistant',kind:'advice',sent_at:e.updated_at,
    message_id:'message:2',text:'來源端確認的建議'});
  assert.equal(validateConversation(e).records.length,2);
});
test('Recorder rejects invented or unsafe source payloads',()=>{
  for(const mutate of [
    e=>{e.records[0].kind='advice';},
    e=>{e.records[0].text='';},
    e=>{e.records[0].sent_at='invalid';},
    e=>{e.records[0].message_id='';},
    e=>{e.records.push({...e.records[0]});},
    e=>{e.conversation_id='';},
    e=>{e.records[0].role='system';},
    e=>{e.updated_at='2026-11-06T03:00:00+08:00';},
    e=>{e.records=Array.from({length:101},(_,i)=>({...e.records[0],message_id:String(i)}));},
    e=>{e.uid='invalid-length-uid';}
  ]){
    const e=example(); mutate(e);
    assert.throws(()=>validateConversation(e));
  }
});
test('Recorder uses authorized MCP checkpoint and record; no background capture',()=>{
  const bg=read('extensions/loc-galaxy/background.mjs');
  const ui=read('extensions/loc-galaxy/workbench.mjs');
  const html=read('extensions/loc-galaxy/workbench.html');
  assert.match(bg,/action:'check',scopeid,conversation_id:input.conversation_id/);
  assert.match(bg,/action:'record',scopeid/);
  assert.match(bg,/const token=await verifiedAccess\(scopeid\)/);
  assert.match(ui,/confirm\(/);
  assert.match(html,/id="conversation-file"/);
  assert.doesNotMatch(bg,/chrome\.alarms|chrome\.scripting|chrome\.tabs\.onUpdated/);
});
