import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL((path.startsWith('../')?path:'../'+path),import.meta.url),'utf8');
test('public Class and statistics calls enforce published-class gate server-side',()=>{
 const server=read('app/loc/keyword-sql-service.mjs');
 assert.match(server,/visible=classes\.filter\(row=>owner\|\|shared\(cfg,row\.uid\)\)/);
 assert.match(server,/if\(!owner&&!shared\(cfg,classUid\)\)fail\('Keyword Class not published',403\)/);
 assert.match(server,/visible=new Set\(\)/);
});
test('frontend receives only native aggregate data, not private raw catalog',()=>{
 const analysis=read('app/loc/keyword-analysis.js');
 const endpoint=read('functions/api/keywords.js');
 assert.match(analysis,/keywordService\('stats'/);
 assert.match(endpoint,/verifiedIdentity\(request,context\.env\)/);
 assert.match(read('../functions/_loc-delegation.mjs'),/crypto\.subtle\.verify/);
 assert.match(read('../functions/_loc-delegation.mjs'),/LOC_DELEGATION_REVOKED_SIDS/);
 assert.doesNotMatch(endpoint,/secret_key|service_role/);
});
test('completion and scan metadata stay separate from Pattern.num and posting UID lists',()=>{
 const service=read('app/loc/keyword-sql-service.mjs');
 assert.match(service,/pattern_scans/);
 assert.match(read('app/loc/keyword-anchor-index.mjs'),/storeScopePatternMatches/);
 assert.match(service,/completeKeywordClass/);
});
