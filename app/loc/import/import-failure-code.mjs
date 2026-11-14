// Stable, non-sensitive short-import error categories.
// Do not return SQL text, user content, connection strings or driver messages.
const SQLSTATE=Object.freeze({
  '42501':'IMPORT_SQL_PERMISSION',
  '42P01':'IMPORT_SQL_TABLE',
  '42703':'IMPORT_SQL_COLUMN',
  '23505':'IMPORT_SQL_CONFLICT',
  '23514':'IMPORT_SQL_CONSTRAINT',
  '23502':'IMPORT_SQL_NOT_NULL',
  '22001':'IMPORT_SQL_LENGTH',
  '22P02':'IMPORT_SQL_VALUE'
});
export function classifyShortImportFailure(error){
  let current=error;
  for(let depth=0;depth<4&&current;depth++){
    const code=String(current.code||'').toUpperCase();
    if(Object.hasOwn(SQLSTATE,code))return SQLSTATE[code];
    if(code.startsWith('08')||['ECONNRESET','ECONNREFUSED','ETIMEDOUT','EAI_AGAIN'].includes(code))
      return 'IMPORT_DB_CONNECTION';
    if(code==='BACKEND_UNAVAILABLE')return 'IMPORT_DB_CONFIGURATION';
    if(code==='40P01')return 'IMPORT_DB_DEADLOCK';
    if(code==='40001')return 'IMPORT_DB_SERIALIZATION';
    if(code==='25P02')return 'IMPORT_DB_TRANSACTION_ABORTED';
    if(code==='57014')return 'IMPORT_DB_QUERY_CANCELLED';
    if(code==='55P03')return 'IMPORT_DB_LOCK_UNAVAILABLE';
    if(code==='53300')return 'IMPORT_DB_CONNECTION_LIMIT';
    // Standard SQLSTATE codes disclose no SQL, contents or credentials.
    if(/^[A-Z0-9]{5}$/.test(code))return 'IMPORT_SQLSTATE_'+code;
    const name=String(current.name||'');
    const message=String(current.message||'');
    if(/Short-import ZModel lookup rejected|Short-import ZModel lookup mismatch|Missing short-import ZModel field/.test(message))
      return 'IMPORT_ZMODEL_LOOKUP';
    if(/LOC Galaxy ZModel (?:import|primary key)|LOC Galaxy import row does not match ZModel|LOC Galaxy import flag mismatch/.test(message))
      return 'IMPORT_ZMODEL_MAPPING';
    if(/ZodError/.test(name)||/Short-import.*(Zod|insert)/.test(message))
      return 'IMPORT_INPUT_VALIDATION';
    if(name==='TypeError')return 'IMPORT_RUNTIME_TYPE';
    if(name==='ReferenceError')return 'IMPORT_RUNTIME_REFERENCE';
    if(name==='RangeError')return 'IMPORT_RUNTIME_RANGE';
    if(name==='NoResultError')return 'IMPORT_UPDATE_NO_RESULT';
    if(name==='AbortedTransactionError')return 'IMPORT_DB_TRANSACTION_ABORTED';
    if(/socket|connection.*(closed|terminated|reset)|network|I\/O context/i.test(message))
      return 'IMPORT_DB_CONNECTION';
    current=current.cause;
  }
  return 'IMPORT_UNCLASSIFIED';
}
