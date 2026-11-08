import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('client sends only one selected Class to authenticated native Keyword analyzer',()=>{
 const ui=read('app/loc/keyword-analysis.js');
 assert.match(ui,/keywordService\('analyze',\{scopeId:id,classUid\}\)/);
 assert.doesNotMatch(ui,/reanalyzeKeywordClass|writeNode|\.update\(\{uid_lists/);
});

test('the indexed parser never reads unchanged Galaxy article bodies',()=>{
 const service=read('app/loc/keyword-sql-service.mjs');
 const pure=read('app/loc/keyword-incremental.mjs');
 assert.match(service,/select\(\['uid','date','createtime','UpdateTime','keyword'\]\)|const cols=\['uid','date','createtime','UpdateTime','keyword'\]/);
 assert.match(service,/analyzeIncrementalKeywordPatterns\(/);
 assert.match(pure,/wordsToCheck\.length/);
 assert.match(pure,/updated>=completed/);
 assert.match(pure,/if\(!wordsToCheck\.length\)\{reused\+\+/);
 assert.doesNotMatch(pure,/\.update\(\{uid_lists/);
});

test('Class status is saved with the word scan times atomically after word index',()=>{
 const service=read('app/loc/keyword-sql-service.mjs');
 assert.match(service,/keyword_meta:JSON\.stringify\(metadata\)/);
 assert.match(service,/pattern_scans:/);
 assert.match(service,/await persistPatterns\(trx,scope,classUid,pending,stats\)/);
 assert.match(service,/completeKeywordClass\(/);
});

test('Culture and Statistics both consume word-backed native summary',()=>{
 const analysis=read('app/loc/keyword-analysis.js');
 const culture=read('app/modular/features/Culture.jsx');
 assert.match(analysis,/keywordService\('stats'/);
 assert.match(culture,/keywordService\('summary'/);
});
