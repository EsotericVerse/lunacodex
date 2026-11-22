import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MAX_ROWS,HEAVY_QUERY_ROWS,NORMAL_QUERY_ROWS}
  from '../app/loc/query/query-batch-size.mjs';
import {createImportBatchSizer,writeImportBatches,validImportBatchSize,
  IMPORT_PAYLOAD_TARGET_BYTES} from '../app/loc/import/batch.mjs';

const src=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('ordinary 1k limits do not cap explicitly requested heavy imports',()=>{
  assert.equal(MAX_ROWS,1000);
  assert.equal(NORMAL_QUERY_ROWS,1000);
  assert.equal(HEAVY_QUERY_ROWS,10000);
  assert.equal(validImportBatchSize(),10000);
  const sizer=createImportBatchSizer();
  assert.ok(sizer.size>1000,'heavy import must not start at 256 or below 1k');
  sizer.observe(sizer.size,1);
  assert.ok(sizer.size>=4096,'good throughput must permit growth above 1k');
  sizer.observe(sizer.size,1);
  assert.ok(sizer.size>=8192,'more growth must remain available');
  sizer.observe(sizer.size,1);
  assert.equal(sizer.size,10000,'dynamic ceiling is 10k');
});

test('heavy writer actually writes >1000 rows at once and still reaches 20k',async()=>{
  const rows=Array.from({length:20000},(_,i)=>({uid:String(i).padStart(8,'0'),title:'a'}));
  const batches=[];
  const result=await writeImportBatches(rows,{
    writeBatch:async part=>{batches.push(part.length);return {count:part.length};}
  });
  assert.equal(result.completed,20000);
  assert.ok(batches.some(n=>n>1000),'no nested fixed 1k write slices');
  assert.ok(batches.every(n=>n<=HEAVY_QUERY_ROWS));
  assert.equal(batches.reduce((a,b)=>a+b,0),20000);
  assert.equal(result.batches,batches.length);
});

test('adaptive writer flushes large texts by bytes rather than sending oversized request',async()=>{
  const articleContent='a'.repeat(1024*1024);
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

test('portable PostgreSQL does not recreate the old 50-row internal insert cap',()=>{
  const port=src('app/loc/providers/sql-engine-ports.mjs');
  assert.match(port,/if\(engine==='postgres'\)return/);
  assert.match(port,/Math\.floor\(32000\/columns\)/);
  assert.match(port,/if\(engine==='mssql'\)return/);
});
