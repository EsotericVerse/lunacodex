// Runtime I/O settings configure file sizes only. SQL reads and COUNTs do not have configurable row ceilings.
const MiB=1048576;
export const IO_LIMIT_CEILINGS=Object.freeze({
  archiveMiB:1024,jsonMiB:50,documentMiB:128,timelineMiB:200
});
// The shared LOC SQL row/transport policy for PostgreSQL, MySQL and T-SQL.
// SQL COUNT(*) is a separate unpaged aggregate: NEVER use any row/page setting
// to constrain COUNT, and NEVER treat a page size as a collection-size limit.
// Physical transport limits apply to returned records; driver-specific SQL
// bind-parameter ceilings remain in their respective dialect adapters.
export const SQL_BATCH_POLICY=Object.freeze({
  returnRows:2048,
  articleUidRows:100,
  heavyStartRows:256,
  heavyMaxRows:10000,
  timeAnchorMaxRows:20000,
  keywordDiscoveryMaxRows:20000,
  keywordDiscoveryTargetBytes:2*1024*1024,
  textTargetChars:1024*1024,
  keywordWorkerTargetChars:128*1024,
  keywordWorkerTargetBytes:256*1024,
  importWriteTargetBytes:480000,
  nativeWriteMaxBytes:700000,
  timeAnchorTargetBytes:2*1024*1024,
  timeAnchorEditorMaxBytes:32*1024*1024
});
export const MAX_ROWS=SQL_BATCH_POLICY.returnRows;
export const NORMAL_QUERY_ROWS=SQL_BATCH_POLICY.returnRows;
export const DB_QUERY_BATCH_SIZE=SQL_BATCH_POLICY.returnRows;
export const ARTICLE_UID_PAGE_ROWS=SQL_BATCH_POLICY.articleUidRows;
export const HEAVY_INITIAL_ROWS=SQL_BATCH_POLICY.heavyStartRows;
export const HEAVY_QUERY_ROWS=SQL_BATCH_POLICY.heavyMaxRows;
export const TIME_ANCHOR_MAX_PAGE_ROWS=SQL_BATCH_POLICY.timeAnchorMaxRows;
export const KEYWORD_DISCOVERY_MAX_ROWS=SQL_BATCH_POLICY.keywordDiscoveryMaxRows;
export const KEYWORD_DISCOVERY_TARGET_BYTES=SQL_BATCH_POLICY.keywordDiscoveryTargetBytes;
export const TEXT_SCAN_TARGET_CHARS=SQL_BATCH_POLICY.textTargetChars;
export const KEYWORD_WORKER_TARGET_CHARS=SQL_BATCH_POLICY.keywordWorkerTargetChars;
export const KEYWORD_WORKER_TARGET_BYTES=SQL_BATCH_POLICY.keywordWorkerTargetBytes;
export const IMPORT_WRITE_TARGET_BYTES=SQL_BATCH_POLICY.importWriteTargetBytes;
export const NATIVE_WRITE_MAX_BYTES=SQL_BATCH_POLICY.nativeWriteMaxBytes;
export const TIME_ANCHOR_TARGET_BYTES=SQL_BATCH_POLICY.timeAnchorTargetBytes;
export const TIME_ANCHOR_EDITOR_MAX_BYTES=SQL_BATCH_POLICY.timeAnchorEditorMaxBytes;
export const clampRows=(n,min,max)=>Math.max(min,Math.min(max,n));

// Prepare bounded SQL JSON recordsets without opening a second transaction.
// Preserve input order and (optionally) adjacent matching physical columns.
export function planJsonRecordsetBatches(rows,{
  maxBytes=IMPORT_WRITE_TARGET_BYTES,maxRows=10000,groupByShape=false
}={}){
  if(!Array.isArray(rows)||!Number.isSafeInteger(maxBytes)||maxBytes<2||
      !Number.isSafeInteger(maxRows)||maxRows<1)
    throw new TypeError('Invalid SQL JSON batch budget');
  const encoder=new TextEncoder(),batches=[];
  let current=[],bytes=2,shape='',columns=[];
  const flush=()=>{
    if(!current.length)return;
    batches.push({columns,serialized:'['+current.join(',')+']',
      rowCount:current.length,bytes});
    current=[];bytes=2;
  };
  for(const row of rows){
    if(!row||typeof row!=='object'||Array.isArray(row))
      throw new TypeError('Invalid SQL JSON record');
    const currentColumns=Object.keys(row);
    const key=groupByShape?[...currentColumns].sort().join('\0'):'';
    const serialized=JSON.stringify(row);
    if(typeof serialized!=='string')
      throw new TypeError('Invalid SQL JSON payload');
    const length=encoder.encode(serialized).byteLength;
    if(current.length&&(key!==shape||current.length>=maxRows||
        bytes+1+length>maxBytes))flush();
    if(!current.length){shape=key;columns=currentColumns;}
    bytes+=length+(current.length?1:0);
    current.push(serialized);
  }
  flush();
  return batches;
}
export function createTextAdaptiveRows({
  initial=HEAVY_INITIAL_ROWS,maximum=HEAVY_QUERY_ROWS,
  targetChars=TEXT_SCAN_TARGET_CHARS,minimum=1
}={}){
  const ceiling=Math.max(1,Math.floor(maximum));
  const floor=clampRows(Math.floor(minimum),1,ceiling);
  let size=clampRows(Math.floor(initial),floor,ceiling);
  const start=size;
  return {
    get size(){return size;},
    get initial(){return start;},
    // Character count is the payload decision; if a page has long content,
    // shrink by powers of two. Short text grows by at most 2x per page.
    observe(rows,characters){
      const count=Math.max(0,Number(rows)||0);
      if(!count)return size;
      const avg=Math.max(1,Math.ceil(Math.max(0,Number(characters)||0)/count));
      if(avg*size>targetChars){
        while(size>floor&&avg*size>targetChars)
          size=Math.max(floor,Math.floor(size/2));
      }else if(size<ceiling&&avg*Math.min(ceiling,size*2)<=targetChars){
        size=Math.min(ceiling,size*2);
      }
      return size;
    }
  };
}
export let MAX_ARCHIVE_BYTES=IO_LIMIT_CEILINGS.archiveMiB*MiB;
export let MAX_JSON_BYTES=IO_LIMIT_CEILINGS.jsonMiB*MiB;
export let MAX_DOCUMENT_BYTES=IO_LIMIT_CEILINGS.documentMiB*MiB;
export let MAX_TIMELINE_BYTES=IO_LIMIT_CEILINGS.timelineMiB*MiB;
export const MAX_DAILY_TRANSFER_BYTES=24*MiB;
export const TIMELINE_IO=Object.freeze({windowBatch:MAX_ROWS,previewPage:MAX_ROWS,writeBatch:MAX_ROWS});

// Hard file-size ceilings are static code constants; no DB caches or
// runtime admin configuration is consulted to set them.

// GET .in() filters are URL-encoded, so MaxRows alone cannot bound a request.
// Keep room for the endpoint, selected columns, authentication gateway and other filters.
export const MAX_GET_URL_CHARS=8000;
export function* urlSafeInBatches(values,column){
  const budget=MAX_GET_URL_CHARS-1024;
  const encode=value=>{
    const raw=String(value);
    return /[,()]/.test(raw)?'"'+raw.replace(/"/g,'\\"')+'"':raw;
  };
  // URLSearchParams escapes separators too: an added comma occupies "%2C".
  // Maintain the encoded length incrementally instead of re-encoding the
  // entire growing batch (quadratic for large archive imports).
  const emptyLength=new URLSearchParams({[column]:'in.()'}).toString().length;
  let batch=[],length=emptyLength;
  for(const value of values||[]){
    const itemLength=new URLSearchParams({v:encode(value)}).toString().length-2;
    if(batch.length>=MAX_ROWS||length+itemLength+(batch.length?3:0)>budget){
      if(!batch.length)throw Error('單筆查詢值太長，無法放入安全的 GET URL');
      yield batch;
      batch=[];
      length=emptyLength;
    }
    if(length+itemLength>budget)throw Error('單筆查詢值太長，無法放入安全的 GET URL');
    length+=itemLength+(batch.length?3:0);
    batch.push(value);
  }
  if(batch.length)yield batch;
}
