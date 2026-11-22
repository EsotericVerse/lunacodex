// Runtime I/O settings configure file sizes only. SQL reads and COUNTs do not have configurable row ceilings.
const MiB=1048576;
export const IO_LIMIT_CEILINGS=Object.freeze({
  archiveMiB:1024,jsonMiB:50,documentMiB:128,timelineMiB:200
});
// Import/write operations preserve their existing 1,000-row batches.
export const MAX_ROWS=1000;
// Per-request SQL result budgets. 10k applies ONLY to explicitly started
// large operations (keyword reanalysis, discovery, import reads); it is NOT a
// Neon/PostgREST/MCP global setting or a demand to hold 10k full bodies.
// Existing 1,000-row write transaction boundaries remain unchanged.
export const NORMAL_QUERY_ROWS=1000;
export const HEAVY_QUERY_ROWS=10000;
// Internal read transport chunk only: total SELECT/COUNT results are never capped.
export const DB_QUERY_BATCH_SIZE=5000;
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
