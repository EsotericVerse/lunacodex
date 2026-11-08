import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('MCP verifies native LOC OAuth and Scope grants without any SQL relay',()=>{
 const router=read('app/loc/mcp/router.mjs');
 const native=read('app/loc/mcp/native-operations.mjs');
 assert.match(router,/verifyOAuthToken/);
 assert.match(native,/verifyDelegationBoundary/);
 assert.match(native,/claims\.db_target/);
 assert.doesNotMatch(native,/LOC_SQL_GATEWAY_URL|gatewayUrl/);
});

test('MCP incoming read/search and append use bounded fixed operations',()=>{
 const native=read('app/loc/mcp/native-operations.mjs');
 const executor=read('app/loc/providers/kysely-mcp.mjs');
 assert.match(native,/mcp-read/);
 assert.match(native,/mcp-search/);
 assert.match(native,/mcp-append/);
 assert.match(executor,/executePortableMcp/);
 assert.match(executor,/user_requested/);
});
