import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeOrdered} from '../app/loc/mcp/ordered-conversation.mjs';
import {readOrdered} from '../app/loc/mcp/ordered-conversation.mjs';
import {orderedBatch} from '../app/loc/mcp/ordered-conversation.mjs';
import {OPTIONS} from '../app/api/las-native/route.js';
import {POST} from '../app/api/las-native/route.js';
import {validateShortImportBatch} from '../app/loc/import/short-append-service.mjs';
import {readFileSync} from 'node:fs';
import {MAX_ROWS} from '../app/loc/query/query-batch-size.mjs';
import {HEAVY_QUERY_ROWS} from '../app/loc/query/query-batch-size.mjs';
import {NORMAL_QUERY_ROWS} from '../app/loc/query/query-batch-size.mjs';
import {createImportBatchSizer} from '../app/loc/import/batch.mjs';
import {writeImportBatches} from '../app/loc/import/batch.mjs';
import {validImportBatchSize} from '../app/loc/import/batch.mjs';
import {recommendImportBatchRows} from '../app/loc/import/batch.mjs';
import {createImportConfirmationWindow} from '../app/loc/import/batch.mjs';
import {IMPORT_FIRST_CHECKPOINT_ROWS} from '../app/loc/import/batch.mjs';
import {IMPORT_MAX_CHECKPOINT_ROWS} from '../app/loc/import/batch.mjs';
import {IMPORT_PAYLOAD_TARGET_BYTES} from '../app/loc/import/batch.mjs';
import {writeImportCheckpoint} from '../app/loc/import/checkpoint.mjs';
import {readImportCheckpoint} from '../app/loc/import/checkpoint.mjs';

{
const url='https://loc.lo3rwang.cc/api/las-native';
const ext='chrome-extension://hiaeafonocnjaclcfgjmdopbcgnafnna';
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
test('LOC existing LAS bridge preflight allows only configured Chrome Extension',()=>{
 const allowed=OPTIONS(new Request(url,{method:'OPTIONS',
   headers:{origin:ext,'access-control-request-method':'POST',
    'access-control-request-headers':'authorization,content-type'}}));
 assert.equal(allowed.status,204);
 assert.equal(allowed.headers.get('access-control-allow-origin'),ext);
 assert.match(allowed.headers.get('access-control-allow-headers'),/Authorization/);
 const denied=OPTIONS(new Request(url,{method:'OPTIONS',
   headers:{origin:'https://untrusted.example'}}));
 assert.equal(denied.status,403);
});
test('LOC direct import never grants unauthenticated ordered writes',async()=>{
 const request=new Request(url,{method:'POST',
   headers:{origin:ext,'content-type':'application/json'},
   body:JSON.stringify({kind:'mcp-conversation',action:'record_ordered',
    scopeid:'lo3rwang',conversation_id:'test://no-auth',records:[a]})});
 const response=await POST(request);
 assert.equal(response.status,401);
 assert.equal(response.headers.get('access-control-allow-origin'),ext);
 assert.match((await response.json()).error.message,/bearer token required/i);
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
test('LOC ordered conversation accepts 300 short turns in one request',()=>{
 const rows=Array.from({length:300},(_,i)=>({
  message_id:'turn-'+i,source_order:i,parent_id:i?'turn-'+(i-1):null,
  role:i%2?'assistant':'user',text:'小段文字'
 }));
 assert.ok(new TextEncoder().encode(JSON.stringify(rows)).length<700000);
 assert.equal(orderedBatch(rows).length,300);
});
}

{
const src=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('Import chooses a 4096 first checkpoint then an 8192 ceiling without a Scope row cap',()=>{
  assert.equal(MAX_ROWS,2048);
  assert.equal(NORMAL_QUERY_ROWS,2048);
  assert.equal(HEAVY_QUERY_ROWS,10000);
  assert.equal(validImportBatchSize(),10000); // Physical DB capability is separate.
  assert.equal(IMPORT_FIRST_CHECKPOINT_ROWS,4096);
  assert.equal(IMPORT_MAX_CHECKPOINT_ROWS,8192);
  const sizer=createImportBatchSizer();
  assert.equal(sizer.size,4096);
  assert.equal(sizer.observe(4096,1,4096*100),8192);
  assert.equal(sizer.observe(8192,1,8192*100),8192);
  // Short records should NOT be forced through 256, 512, 1024, 2048.
  const short=Array.from({length:128},(_,i)=>({
    uid:String(i).padStart(8,'0'),title:'a'
  }));
  assert.equal(recommendImportBatchRows(short),4096);
  assert.equal(createImportBatchSizer({sampleRows:short}).size,4096);
  const long=[{uid:'AAAA0001',content:'x'.repeat(8000)}];
  assert.ok(recommendImportBatchRows(long)<4096);
  assert.ok(createImportBatchSizer({sampleRows:long}).size<4096);
  // Large content still shrinks a physical batch instead of capping the import.
  assert.ok(sizer.observe(256,1,256*20000)<8192);
});

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


test('each explicit SQL Type preserves its own parameter-safe insert budget',()=>{
  const port=src('app/loc/providers/sql-engine-ports.mjs');
  const pg=src('modules/loc/dialect/postgres.mjs');
  const mysql=src('modules/loc/dialect/mysql.mjs');
  const mssql=src('modules/loc/dialect/mssql.mjs');
  assert.match(port,/Math\.floor\(type\.insertParameterLimit\/columns\)/);
  assert.match(pg,/insertParameterLimit:32000,insertMaxRows:10000/);
  assert.match(mysql,/insertParameterLimit:32000,insertMaxRows:50/);
  assert.match(mssql,/insertParameterLimit:2000,insertMaxRows:50/);
});

test('Import confirmation windows never skip milestones or loop when sizes match',()=>{
  const windows=createImportConfirmationWindow();
  assert.equal(windows.remaining(0),4096);
  assert.equal(windows.reached(4095),false);
  assert.equal(windows.reached(4096),true);
  assert.equal(windows.next,8192);
  assert.equal(windows.reached(8192),true);
  assert.equal(windows.next,16384);
  assert.equal(windows.reached(16384),true);
  assert.equal(windows.next,24576);
  const equal=createImportConfirmationWindow({firstRows:4,maxRows:4});
  assert.equal(equal.reached(4),true);
  assert.equal(equal.next,8);
  assert.equal(equal.reached(8),true);
  assert.equal(equal.next,12);
});


test('Import batch sampling uses final physical Galaxy and MediaAnchor row shapes',()=>{
  const panel=src('app/loc/import/ManagementImportPanel.jsx');
  assert.match(panel,/const prepared=createMedia.map\(mediaAnchorRecord\)/);
  assert.match(panel,/writeImportBatches\(prepared,\{/);
  assert.match(panel,/const prepareArticleForWrite=record=>/);
  assert.match(panel,/\.slice\(0,128\)\.map\(prepareArticleForWrite\)/);
  assert.match(panel,/const incoming=prepareArticleForWrite\(record\)/);
  // Physical rows do not grow new keys AFTER the transport byte measurement.
  assert.doesNotMatch(panel,/batch\.map\(record=>\(\{/);
});
}
