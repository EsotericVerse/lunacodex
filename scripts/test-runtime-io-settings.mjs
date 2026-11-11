import assert from 'node:assert/strict';
import {test} from 'node:test';
import {applyRuntimeIoLimits,IO_LIMIT_CEILINGS} from '../app/loc/query-batch-size.mjs';
import * as limits from '../app/loc/query-batch-size.mjs';

test('runtime I/O settings govern files without changing read or write row chunks',()=>{
  try {
    const saved=applyRuntimeIoLimits({maxRows:500,archiveMiB:128,jsonMiB:12});
    assert.equal(Object.hasOwn(saved,'maxRows'),false);
    assert.equal(limits.MAX_ROWS,1000);
    assert.equal(limits.DB_QUERY_BATCH_SIZE,5000);
    assert.equal(limits.TIMELINE_IO.writeBatch,1000);
    assert.equal(limits.MAX_ARCHIVE_BYTES,128*1048576);
    assert.equal(limits.MAX_JSON_BYTES,12*1048576);
    assert.throws(()=>applyRuntimeIoLimits({archiveMiB:IO_LIMIT_CEILINGS.archiveMiB+1}));
    assert.equal(limits.MAX_ROWS,1000,'invalid settings must not change the fixed write batch');
  } finally {applyRuntimeIoLimits({});}
});

test('URL-bounded import lookup batches match the legacy partition for mixed Unicode IDs',()=>{
  const values=Array.from({length:1400},(_,i)=>
    'post-'+i+(i%11===0?'(附註,你好)':i%17===0?'😀"test':''));
  const encode=value=>{
    const raw=String(value);
    return /[,()]/.test(raw)?'"'+raw.replace(/"/g,'\\"')+'"':raw;
  };
  const legacy=[];
  let current=[];
  const queryLength=batch=>new URLSearchParams({
    site_id:'in.('+batch.map(encode).join(',')+')'
  }).toString().length;
  for(const value of values){
    const candidate=[...current,value];
    if(candidate.length>limits.MAX_ROWS||queryLength(candidate)>limits.MAX_GET_URL_CHARS-1024){
      legacy.push(current);current=[value];
    }else current=candidate;
  }
  if(current.length)legacy.push(current);
  const batches=[...limits.urlSafeInBatches(values,'site_id')];
  assert.deepEqual(batches,legacy);
  assert.ok(batches.every(batch=>queryLength(batch)<=limits.MAX_GET_URL_CHARS-1024));
  assert.deepEqual([...limits.urlSafeInBatches([],'uid')],[]);
  assert.throws(()=>[...limits.urlSafeInBatches(['x'.repeat(9000)],'uid')],/單筆查詢值太長/);
});
