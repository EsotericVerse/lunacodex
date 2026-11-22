// Runtime I/O settings configure file sizes only. SQL reads and COUNTs do not have configurable row ceilings.
const MiB=1048576;
export const IO_LIMIT_CEILINGS=Object.freeze({
  archiveMiB:1024,jsonMiB:50,documentMiB:128,timelineMiB:200
});
// Physical row transport only. Never use this value as a COUNT(*) limit
// or as the total number of Anchor/Keyword/Galaxy records in a collection.
export const MAX_ROWS=2048;
export const NORMAL_QUERY_ROWS=MAX_ROWS;
export const DB_QUERY_BATCH_SIZE=MAX_ROWS;
export const ARTICLE_UID_PAGE_ROWS=100;
// Large text jobs begin with calibration and double based on *observed text
// length*, not SQL COUNT, UI list size, or the number of browser connections.
export const HEAVY_INITIAL_ROWS=256;
export const HEAVY_QUERY_ROWS=10000;
export const TIME_ANCHOR_MAX_PAGE_ROWS=20000;
export const TEXT_SCAN_TARGET_CHARS=1024*1024;
export const clampRows=(n,min,max)=>Math.max(min,Math.min(max,n));
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
