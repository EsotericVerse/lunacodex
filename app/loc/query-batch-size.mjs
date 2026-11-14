// Runtime I/O settings configure file sizes only. SQL reads and COUNTs do not have configurable row ceilings.
const MiB=1048576;
export const IO_LIMIT_CEILINGS=Object.freeze({
  archiveMiB:1024,jsonMiB:50,documentMiB:128,timelineMiB:200
});
// Import/write operations preserve their existing 1,000-row batches.
export const MAX_ROWS=1000;
// Internal read transport chunk only: total SELECT/COUNT results are never capped.
export const DB_QUERY_BATCH_SIZE=5000;
export let MAX_ARCHIVE_BYTES=IO_LIMIT_CEILINGS.archiveMiB*MiB;
export let MAX_JSON_BYTES=IO_LIMIT_CEILINGS.jsonMiB*MiB;
export let MAX_DOCUMENT_BYTES=IO_LIMIT_CEILINGS.documentMiB*MiB;
export let MAX_TIMELINE_BYTES=IO_LIMIT_CEILINGS.timelineMiB*MiB;
export const MAX_DAILY_TRANSFER_BYTES=24*MiB;
export const TIMELINE_IO=Object.freeze({windowBatch:MAX_ROWS,previewPage:MAX_ROWS,writeBatch:MAX_ROWS});

// One pure IO range contract for both protected writes and browser limits.
export function normalizeRuntimeIoLimits(settings={}){
  const bounded=key=>{
    const value=settings?.[key];
    if(value===undefined||value===null)return IO_LIMIT_CEILINGS[key];
    const number=Number(value);
    if(!Number.isSafeInteger(number)||number<1||number>IO_LIMIT_CEILINGS[key])
      throw new Error(key+' 超出允許範圍');
    return number;
  };
  return Object.fromEntries(Object.keys(IO_LIMIT_CEILINGS).map(key=>[key,bounded(key)]));
}
export function decodeRuntimeIo(value){
  const c=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  const v=c.io_limits;
  return {io_limits:v&&typeof v==='object'&&!Array.isArray(v)?v:{}};
}
export function encodeRuntimeIo(input){
  const v=input?.io_limits;
  if(!v||typeof v!=='object'||Array.isArray(v))
    throw new Error('I/O 限制設定格式錯誤');
  // Retired ISR settings are not propagated by any future authorized edit.
  return {io_limits:normalizeRuntimeIoLimits(v)};
}
export function applyRuntimeIoLimits(settings={}){
  const values=normalizeRuntimeIoLimits(settings);
  MAX_ARCHIVE_BYTES=values.archiveMiB*MiB;
  MAX_JSON_BYTES=values.jsonMiB*MiB;
  MAX_DOCUMENT_BYTES=values.documentMiB*MiB;
  MAX_TIMELINE_BYTES=values.timelineMiB*MiB;
  return values;
}

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
