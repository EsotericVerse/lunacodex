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
    const name=String(current.name||'');
    const message=String(current.message||'');
    if(/Short-import ZModel lookup rejected|Short-import ZModel lookup mismatch|Missing short-import ZModel field/.test(message))
      return 'IMPORT_ZMODEL_LOOKUP';
    if(/LOC Galaxy ZModel (?:import|primary key)|LOC Galaxy import row does not match ZModel|LOC Galaxy import flag mismatch/.test(message))
      return 'IMPORT_ZMODEL_MAPPING';
    if(/ZodError/.test(name)||/Short-import.*(Zod|insert)/.test(message))
      return 'IMPORT_INPUT_VALIDATION';
    current=current.cause;
  }
  return 'IMPORT_UNCLASSIFIED';
}
