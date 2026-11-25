// The LOC bulk route is a website-owned, bounded import contract, not a SQL API.
import {BULK_IMPORT_MAX_ROWS,BULK_IMPORT_MAX_BYTES,IMPORT_WRITE_TARGET_BYTES}
  from '../query/query-batch-size.mjs';
const encoder=new TextEncoder();
const RELATION=/^silver\.([a-z][a-z0-9]{0,14})_(galaxy|anchor)$/;
const fail=message=>Object.assign(new Error(message),{httpStatus:400});
export function bulkImportEnvelope(payload){
  const match=RELATION.exec(String(payload?.p_table||''));
  const rows=payload?.p_rows;
  if(!payload||typeof payload!=='object'||Array.isArray(payload)||!match||
    !['insert','update_batch'].includes(payload.p_operation)||
    (payload.p_operation==='update_batch'&&match[2]!=='galaxy')||
    !Array.isArray(rows)||!rows.length||rows.length>BULK_IMPORT_MAX_ROWS||
    payload.p_values!=null||
    !Array.isArray(payload.p_filters)||payload.p_filters.length||
    Object.keys(payload).some(k=>!['p_table','p_operation','p_rows','p_values','p_filters'].includes(k)))
    throw fail('Invalid LOC bulk import operation');
  return {kind:'bulk-import',scopeid:match[1],payload};
}
export function validateBulkImportEnvelope(body){
  if(!body||Object.keys(body).sort().join(',')!=='kind,payload,scopeid'||
    body.kind!=='bulk-import')throw fail('Invalid LOC bulk import envelope');
  const expected=bulkImportEnvelope(body.payload);
  if(body.scopeid!==expected.scopeid)throw fail('LOC bulk import Scope mismatch');
  return {kind:'managed-write',scopeid:expected.scopeid,payload:expected.payload};
}
export function encodeBulkImport(payload){
  const json=JSON.stringify(bulkImportEnvelope(payload));
  if(encoder.encode(json).byteLength>BULK_IMPORT_MAX_BYTES)
    throw Object.assign(new Error('LOC 匯入請求超過 32 MiB'),{status:413});
  return json;
}
// Only used after the server explicitly confirms its gate was closed
// before reading the body. Never replay an ambiguous or failed commit.
export function* closedGateImportChunks(payload){
  bulkImportEnvelope(payload);
  const overhead=encoder.encode(JSON.stringify({...payload,p_rows:[]})).byteLength+256;
  let rows=[],bytes=overhead;
  for(const row of payload.p_rows){
    const size=encoder.encode(JSON.stringify(row)).byteLength+1;
    if(size+overhead>IMPORT_WRITE_TARGET_BYTES)
      throw new Error('單筆資料超過普通寫入容量；須開啟 LOC 大量匯入入口。');
    if(rows.length&&bytes+size>IMPORT_WRITE_TARGET_BYTES){
      yield {...payload,p_rows:rows};
      rows=[];bytes=overhead;
    }
    rows.push(row);bytes+=size;
  }
  if(rows.length)yield {...payload,p_rows:rows};
}
