import test from 'node:test';
import assert from 'node:assert/strict';
import {orderedBatch,readOrdered,mergeOrdered} from '../app/loc/mcp/ordered-conversation.mjs';
const msg=(i,role='user',text='turn '+i)=>({
 message_id:'msg-'+i,role,source_order:i,parent_id:null,text
});
test('late old turns enter their source order; no capture time is consulted',()=>{
 const last=mergeOrdered(null,[msg(100,'assistant')]);
 const first=mergeOrdered(last.content,[msg(20,'user'),msg(50,'assistant')]);
 assert.deepEqual(readOrdered(first.content).map(x=>x.source_order),[20,50,100]);
 assert.ok(first.content.indexOf('turn 20')<first.content.indexOf('turn 50'));
 assert.ok(first.content.indexOf('turn 50')<first.content.indexOf('turn 100'));
 assert.equal(first.added,2);
});
test('idempotent replays do not duplicate a message',()=>{
 const first=mergeOrdered(null,[msg(5)]);
 const repeated=mergeOrdered(first.content,[msg(5)]);
 assert.equal(repeated.added,0);
 assert.deepEqual(readOrdered(repeated.content).map(x=>x.message_id),['msg-5']);
});
test('IDs or ordinals cannot silently override existing turns',()=>{
 const prior=mergeOrdered(null,[msg(5)]);
 assert.throws(()=>mergeOrdered(prior.content,[msg(5,'user','different')]),/conflicting source record/);
 assert.throws(()=>mergeOrdered(prior.content,[{...msg(6),source_order:5}]),/belongs to another/);
 assert.throws(()=>orderedBatch([msg(1),{...msg(1),message_id:'other'}]),/Duplicate/);
 assert.throws(()=>orderedBatch([{...msg(1),source_order:null}]),/ordinal/);
});
test('legacy text remains untouched until separate recovery, never appended or rewritten',()=>{
 assert.throws(()=>mergeOrdered('[[LOC-Append-Event:old]]\n[user] hello',[msg(2)]),
  /Legacy conversation format/);
 assert.throws(()=>readOrdered('[[LOC-OrderedConversation:v1]]\nnot json\n[[\/LOC-OrderedConversation]]\n'),
  /Invalid ordered conversation JSON/);
});
test('readable rendering and structured metadata remain in one original-order article',()=>{
 const result=mergeOrdered(null,[msg(4,'assistant','reply'),msg(2,'user','question')]);
 assert.equal(result.count,2);
 const marker='[[/LOC-OrderedConversation]]';
 const readable=result.content.slice(result.content.indexOf(marker)+marker.length);
 assert.ok(readable.indexOf('question')<readable.indexOf('reply'));
 assert.match(readable,/使用者/);
 assert.match(readable,/AI 回覆/);
});
