// Private fixed-operation compute contract. No SQL, credentials or file persistence.
export const COMPUTE_PROTOCOL='loc-compute-v1';
export const COMPUTE_MAX_BYTES=8*1024*1024;
export const COMPUTE_IMPORT_BYTES=550*1024;
export const COMPUTE_MIN_ROWS=512;
export const COMPUTE_KINDS=Object.freeze(['keyword','site','time']);
export const byteLength=value=>new TextEncoder().encode(JSON.stringify(value)).byteLength;
export function identityProjection(row){
  return {uid:String(row.uid||''),site:String(row.site||''),site_id:String(row.site_id||''),
    createtime:row.createtime instanceof Date?row.createtime.toISOString():row.createtime??null,
    __importTimeSource:row.__importTimeSource??null};
}
export function validIdentity(row){
  return row&&typeof row==='object'&&!Array.isArray(row)&&
    Object.keys(row).every(k=>['uid','site','site_id','createtime','__importTimeSource'].includes(k))&&
    /^[A-Za-z0-9]{8}$/.test(row.uid)&&typeof row.site==='string'&&row.site.length<=512&&
    typeof row.site_id==='string'&&row.site_id.length<=2048&&
    (row.createtime===null||typeof row.createtime==='string'&&row.createtime.length<=128)&&
    (row.__importTimeSource===null||typeof row.__importTimeSource==='string'&&row.__importTimeSource.length<=32);
}
