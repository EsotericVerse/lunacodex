import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MAX_ROWS,HEAVY_QUERY_ROWS,NORMAL_QUERY_ROWS}
  from '../app/loc/query/query-batch-size.mjs';
import {createImportBatchSizer,writeImportBatches,validImportBatchSize,
  recommendImportBatchRows,createImportConfirmationWindow,
  IMPORT_FIRST_CHECKPOINT_ROWS,IMPORT_MAX_CHECKPOINT_ROWS,
  IMPORT_PAYLOAD_TARGET_BYTES} from '../app/loc/import/batch.mjs';
import {writeImportCheckpoint,readImportCheckpoint}
  from '../app/loc/import/checkpoint.mjs';

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

test('both Galaxy insert and update importer routes obey actual measured bytes',()=>{
  const panel=src('app/loc/import/ManagementImportPanel.jsx');
  const provider=src('app/loc/db/db-contract.mjs');
  const pg=src('app/loc/providers/kysely-management.mjs');
  assert.match(panel,/insertSizer\.shouldFlush\(payload\.length,payloadBytes,bytes\)/);
  assert.match(panel,/updateSizer\.shouldFlush\(updateQueue\.length,updateBytes,bytes\)/);
  assert.match(panel,/imageSizer\.shouldFlush\(pending\.length,pendingBytes,bytes\)/);
  assert.match(provider,/const batchSize=HEAVY_QUERY_ROWS/);
  assert.match(pg,/jsonb_populate_recordset/);
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

test('Import article writer binds confirmation windows to existing checkpoint receipts',()=>{
  const panel=src('app/loc/import/ManagementImportPanel.jsx');
  assert.match(panel,/const updateWindows=createImportConfirmationWindow\(\)/);
  assert.match(panel,/updateWindows.reached\(checkedExisting\)/);
  assert.match(panel,/const insertWindows=createImportConfirmationWindow\(\)/);
  assert.match(panel,/insertWindows.reached\(newArticleProcessed\+payload.length\)/);
  assert.match(panel,/checkpointBatch\('insert',newArticleProcessed,newArticleTotal,/);
  assert.match(panel,/checkpointBatch\('update',checkedExisting,existingCount,updated\)/);
  // A receipt is evidence of finished writes, NOT a row-skipping cursor.
  const checkpoint=src('app/loc/import/checkpoint.mjs');
  assert.match(checkpoint,/must still compare/);
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
