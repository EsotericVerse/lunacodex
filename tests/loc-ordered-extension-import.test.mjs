import test from 'node:test';
import assert from 'node:assert/strict';
import {processShortImport} from '../app/loc/import/short-append-service.mjs';
import {executeLocConversation}
 from '../app/loc/mcp/conversations.mjs';
import {mergeOrdered} from '../app/loc/mcp/ordered-conversation.mjs';
import {readOrdered} from '../app/loc/mcp/ordered-conversation.mjs';
import {orderedBatch} from '../app/loc/mcp/ordered-conversation.mjs';
import {validateShortImportBatch} from '../app/loc/import/short-append-service.mjs';
import {readFileSync} from 'node:fs';
import {createImportBatchSizer} from '../app/loc/import/batch.mjs';
import {writeImportBatches} from '../app/loc/import/batch.mjs';
import {IMPORT_PAYLOAD_TARGET_BYTES} from '../app/loc/import/batch.mjs';
import {writeImportCheckpoint} from '../app/loc/import/checkpoint.mjs';
import {readImportCheckpoint} from '../app/loc/import/checkpoint.mjs';

{
const a={message_id:'turn-a',role:'user',source_order:0,parent_id:null,text:'開始'};
const b={message_id:'turn-b',role:'assistant',source_order:1,parent_id:'turn-a',text:'回覆'};

test('LOC ordered import sorts by original source_order and preserves IDs',()=>{
 const first=mergeOrdered(null,[b,a]);
 assert.equal(first.added,2);
 assert.deepEqual(readOrdered(first.content).map(x=>x.message_id),['turn-a','turn-b']);
});
test('LOC ordered import retries are idempotent and reject ordinal conflicts',()=>{
 const first=mergeOrdered(null,[a,b]);
 const repeated=mergeOrdered(first.content,[a,b]);
 assert.equal(repeated.added,0);
 assert.equal(repeated.count,2);
 assert.throws(()=>mergeOrdered(first.content,[{...b,message_id:'another'}]),/ordinal/);
 assert.throws(()=>orderedBatch([a,{...a}]),/Duplicate/);
});
}

{
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
}

{
const src=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('heavy writer actually writes >1000 rows at once and still reaches 20k',async()=>{
  const rows=Array.from({length:20000},(_,i)=>({uid:String(i).padStart(8,'0'),title:'a'}));
  const batches=[],confirmed=[];
  const stored=new Map(),storage={
    getItem:key=>stored.get(key)||null,
    setItem:(key,value)=>stored.set(key,value),
    removeItem:key=>stored.delete(key)
  };
  const file={name:'archive.json',size:12345,lastModified:77};
  const result=await writeImportBatches(rows,{
    writeBatch:async part=>{batches.push(part.length);return {count:part.length};},
    onProgress:progress=>{
      writeImportCheckpoint(storage,{
        scopeId:'lo3rwang',ownerId:'test-user',file,
        phase:'insert',confirmed:progress.completed,total:progress.total
      });
      if(progress.checkpoint)confirmed.push(progress.completed);
    }
  });
  assert.equal(result.completed,20000);
  assert.deepEqual(batches,[4096,4096,8192,3616]);
  assert.deepEqual(confirmed,[4096,8192,16384]);
  assert.ok(batches.every(n=>n<=8192));
  assert.equal(batches.reduce((a,b)=>a+b,0),20000);
  assert.equal(result.batches,batches.length);
  const saved=readImportCheckpoint(storage,{
    scopeId:'lo3rwang',ownerId:'test-user',file
  });
  assert.equal(saved.confirmed,20000);
});

test('adaptive writer flushes large texts by bytes rather than sending oversized request',async()=>{
  const articleContent='a'.repeat(64*1024);
  const rows=Array.from({length:24},(_,i)=>({
    uid:String(i).padStart(8,'0'),content:articleContent
  }));
  const size=createImportBatchSizer(),sent=[];
  assert.equal(size.maxBytes,IMPORT_PAYLOAD_TARGET_BYTES);
  const result=await writeImportBatches(rows,{writeBatch:async part=>{
    const bytes=part.reduce((sum,row)=>sum+size.byteSize(row),0);
    assert.ok(bytes<=IMPORT_PAYLOAD_TARGET_BYTES);
    sent.push(part.length);
    return {count:part.length};
  }});
  assert.equal(result.completed,24);
  assert.ok(sent.length>1);
});



}

{
const uuid=i=>'00000000-0000-4000-8000-'+String(i).padStart(12,'0');
const url='https://chatgpt.com/c/abcd';
const event={id:uuid(1),group_id:uuid(2),source_key:url,url,
 write_mode:'append',kind:'capture',title:'Test conversation',content:'你好',
 captured_at:'2026-11-24T00:00:00.000Z',part_index:0,part_count:1};
const batch={id:uuid(3),write_mode:'append',records:[event]};
const actor={authorized:true,scopeid:'lo3rwang',subject:'verified-user'};
test('short import keeps the same UID and relabels legacy mcp even on retry',async()=>{
 const original={uid:'AABBCCDD',site:'mcp',site_id:'gl:legacy',
  content:'old content'};
 const calls=[];
 const store={transaction:async(_scope,run)=>run({
  lockSource:async()=>{},
  lookupMany:async ids=>[{...original,site_id:ids[0]}],
  relabelSource:async(uid,id,from,to)=>{
   calls.push(['relabel',uid,id,from,to]);original.site=to;
  },
  append:async(uid,id,tail)=>{
   calls.push(['append',uid,id]);original.content+='\n'+tail;
  },
  insertMany:async()=>{throw Error('duplicate source must not insert')}
 })};
 const result=await processShortImport(batch,actor,{store});
 assert.equal(result.accepted,true);
 assert.equal(result.articles[0].uid,'AABBCCDD');
 assert.equal(result.articles[0].appended,1);
 assert.equal(original.site,'ChatGPT');
 assert.equal(calls.filter(x=>x[0]==='relabel').length,1);
 const repeated=await processShortImport(batch,actor,{store});
 assert.equal(repeated.articles[0].appended,0);
 assert.equal(calls.filter(x=>x[0]==='relabel').length,1);
 assert.equal(calls.filter(x=>x[0]==='append').length,1);
});

const orderedA={message_id:'a',source_order:0,parent_id:null,role:'user',text:'開始'};
const orderedB={message_id:'b',source_order:1,parent_id:'a',role:'assistant',text:'回覆'};
const incoming={action:'record_ordered',scopeid:'lo3rwang',
 conversation_id:url,updated_at:'2026-11-24T00:00:00.000Z',
 records:[orderedA,orderedB]};
const claims={provider:'loc',me:true,grants:['lo3rwang:write']};
test('record_ordered creates a ChatGPT From row, never a site=mcp row',async()=>{
 let written;
 const db={
  selectFrom:()=>({
   select(){return this;},where(){return this;},orderBy(){return this;},
   limit(){return this;},async execute(){return [];}
  }),
  insertInto:()=>({
   values(row){written=row;return this;},async executeTakeFirst(){return {};}
  })
 };
 const receipt=await executeLocConversation(db,incoming,claims);
 assert.equal(receipt.accepted,true);
 assert.equal(receipt.count,2);
 assert.equal(written.site,'ChatGPT');
 assert.equal(written.site_id,url);
});
test('record_ordered duplicate relabels legacy source without changing UID or text',async()=>{
 const initial=mergeOrdered(null,[orderedA,orderedB]);
 const stored={uid:'ABCDEFGH',site:'mcp',site_id:url,
  title:'Original',content:initial.content,UpdateTime:'2026-11-23T00:00:00.000Z'};
 const db={
  selectFrom:()=>({
   select(){return this;},where(){return this;},orderBy(){return this;},
   limit(){return this;},async execute(){return [stored];}
  }),
  updateTable:()=>({
   set(update){this.update=update;return this;},
   where(){return this;},async executeTakeFirst(){
    assert.equal(Object.hasOwn(this.update,'content'),false);
    Object.assign(stored,this.update);
    return {numUpdatedRows:1};
   }
  })
 };
 const receipt=await executeLocConversation(db,incoming,claims);
 assert.equal(receipt.accepted,true);
 assert.equal(receipt.duplicate,true);
 assert.equal(receipt.count,0);
 assert.equal(receipt.uid,'ABCDEFGH');
 assert.equal(stored.site,'ChatGPT');
 assert.equal(stored.content,initial.content);
});
}
