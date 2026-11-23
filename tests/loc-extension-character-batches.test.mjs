import test from 'node:test';
import assert from 'node:assert/strict';
import {validateShortImportBatch}
 from '../app/loc/import/short-append-service.mjs';
import {orderedBatch} from '../app/loc/mcp/ordered-conversation.mjs';

const uuid=i=>'00000000-0000-4000-8000-'+String(i).padStart(12,'0');
const source='https://example.com/article';
const record=i=>({
 id:uuid(i+1),group_id:uuid(99999+i),source_key:source,url:source,
 write_mode:'append',kind:'capture',title:'文章',content:'一段短文',
 captured_at:'2026-11-23T00:00:00.000Z',part_index:0,part_count:1
});
test('LOC accepts more than 50 short import rows when total bytes fit',()=>{
 const input={id:uuid(123456),write_mode:'append',records:
  Array.from({length:300},(_,i)=>record(i))};
 const bytes=new TextEncoder().encode(JSON.stringify(input)).length;
 assert.ok(bytes<601024);
 const result=validateShortImportBatch(input);
 assert.equal(result.records.length,300);
});
test('LOC still rejects short import when total JSON exceeds 601024 bytes',()=>{
 const input={id:uuid(123456),write_mode:'append',records:
  Array.from({length:10},(_,i)=>({...record(i),content:'中'.repeat(25000)}))};
 assert.ok(new TextEncoder().encode(JSON.stringify(input)).length>601024);
 assert.throws(()=>validateShortImportBatch(input),e=>e.httpStatus===413);
});
test('LOC ordered conversation accepts 300 short turns in one request',()=>{
 const rows=Array.from({length:300},(_,i)=>({
  message_id:'turn-'+i,source_order:i,parent_id:i?'turn-'+(i-1):null,
  role:i%2?'assistant':'user',text:'小段文字'
 }));
 assert.ok(new TextEncoder().encode(JSON.stringify(rows)).length<700000);
 assert.equal(orderedBatch(rows).length,300);
});
test('LOC keeps source-order conflicts fail-closed',()=>{
 assert.throws(()=>orderedBatch([
  {message_id:'a',source_order:1,parent_id:null,role:'user',text:'hi'},
  {message_id:'b',source_order:1,parent_id:'a',role:'assistant',text:'ok'}
 ]),e=>e.httpStatus===409);
});
