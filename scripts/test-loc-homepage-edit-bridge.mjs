import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('LOC homepage always reads existing page_name=index Blocks',()=>{
 const source=read('app/loc/scope-data.js');
 assert.match(source,/return selectLiveScopeBlocks\(id,name\)/);
 assert.match(source,/page_name/);
 assert.doesNotMatch(source,/publicAction\('page_blocks'/);
 const runtime=read('app/loc/runtime-config.mjs');
 assert.match(runtime,/schema\('api'\)\.from\('manage'\)/);
});

test('native LOC Auth remains separate from the data driver',()=>{
 const configured=read('app/loc/providers/configured.mjs');
 const browser=read('app/loc/auth/loc-browser.mjs');
 assert.match(configured,/createLocAccountAdapter/);
 assert.match(browser,/auth\.lo3rwang\.cc|LOC_CONTROL_URL/);
 assert.doesNotMatch(configured,/createLocGatewayAdapter|createKyselyEdgeClient/);
});

test('MCP and Extension route fixed signed operations to native Kysely',()=>{
 const native=read('app/loc/mcp/native-operations.mjs');
 const bridge=read('workers/loc-authority/native-oauth.mjs');
 const handler=read('functions/api/loc-native.js');
 assert.match(native,/verifyDelegationBoundary/);
 assert.match(native,/processShortImport/);
 assert.match(handler,/handleNativeLocOperation/);
 assert.match(bridge,/short-import/);
});
