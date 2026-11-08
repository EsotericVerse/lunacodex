import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('Class reset is a server-authorized Pattern Anchor mutation, not a browser UID-list write',()=>{
 const client=read('app/loc/db-contract.mjs');
 const service=read('app/loc/keyword-sql-service.mjs');
 const a=client.indexOf('  async function resetKeywordClassification(');
 const b=client.indexOf('  async function verifiedKeywordOwner(',a);
 assert.ok(a>=0&&b>a);
 const body=client.slice(a,b);
 assert.match(body,/keywordService\('reset',\{scopeId:scope,classUid:uid\}\)/);
 assert.doesNotMatch(body,/uid_lists|keywordUidListRecord|\.update\(/);
 assert.match(service,/invalidateKeywordClass\(existing\.keyword_meta,classUid\)/);
 assert.match(service,/const unique=\[\.\.\.own\]\.filter\(word=>!other\.has\(word\)\)/);
});
test('selected Class reset cannot delete terms still used by another Class',()=>{
 const source=read('app/loc/keyword-sql-service.mjs');
 assert.match(source,/const reset=stored\.filter\(row=>unique\.includes\(norm\(row\.pattern\)\)\&\&row\.uid_list\.length\)/);
 assert.match(source,/retainedShared:own\.size-unique\.length/);
});
test('the article index is written in bounded SQL batches and then marks Class complete',()=>{
 const source=read('app/loc/keyword-sql-service.mjs');
 assert.match(source,/storeScopePatternMatches\(trx,scope,dbUid,patterns\)/);
 assert.match(read('app/loc/keyword-anchor-index.mjs'),/for\(let i=0;i<updates\.length;i\+=100\)/);
 assert.match(source,/keyword_meta:JSON\.stringify\(metadata\)/);
});
