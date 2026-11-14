import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {classifyShortImportFailure} from '../app/loc/import/import-failure-code.mjs';

for(const [code,expected] of [
  ['42501','IMPORT_SQL_PERMISSION'],['42P01','IMPORT_SQL_TABLE'],
  ['42703','IMPORT_SQL_COLUMN'],['23505','IMPORT_SQL_CONFLICT'],
  ['23514','IMPORT_SQL_CONSTRAINT'],['22001','IMPORT_SQL_LENGTH'],
  ['ECONNRESET','IMPORT_DB_CONNECTION'],['BACKEND_UNAVAILABLE','IMPORT_DB_CONFIGURATION']
])assert.equal(classifyShortImportFailure({code}),expected,code);
assert.equal(classifyShortImportFailure(new Error('Short-import ZModel lookup rejected')),
  'IMPORT_ZMODEL_LOOKUP');
assert.equal(classifyShortImportFailure({cause:{code:'23514'}}),'IMPORT_SQL_CONSTRAINT');
assert.equal(classifyShortImportFailure(new Error('sensitive SQL data')),'IMPORT_UNCLASSIFIED');
const native=readFileSync(new URL('../app/loc/mcp/native-operations.mjs',import.meta.url),'utf8');
assert.match(native,/operationKind==='short-import'&&status>=500/);
assert.match(native,/LOC native database operation unavailable/);
assert.match(native,/importCode\?' \['\+importCode\+'\]'/);
assert.match(native,/\.\.\.\(importCode\?\{code:importCode\}:\{\}\)/);
console.log('PASS Short-import 500 safe SQLSTATE and ZModel error classification; no data or secrets');
