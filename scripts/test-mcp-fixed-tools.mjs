// Prevent accidentally re-exposing dynamic upstream Provider management tools.
// This checks the actual MCP router's public tool registry and dispatch gate.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const router=readFileSync(new URL('../app/loc/mcp/router.mjs',import.meta.url),'utf8');
const found=[...router.matchAll(/\{name:'([^']+)',description:/g)].map(x=>x[1]);
assert.deepEqual(found,[
  'loc_connection_status','read_memory','scope_storage',
  'galaxy_link','article_distribution'
]);
assert.doesNotMatch(router,/provider_(?:list|tools|call|receipt)/,
  'Dynamic Provider management must not be advertised or dispatchable');
assert.match(router,/if\(!TOOLS\.some\(tool=>tool\.name===name\)\)/,
  'Unknown tools must fail before invoking any function');
assert.match(router,/await businessAction\(name,args,bearer,env\)/);
assert.match(router,/checkMcpGatewayQos\(identity\.subject\)/);
assert.match(router,/verifyOAuthToken\(request,config\)/);
console.log('PASS MCP fixed tool surface: 5 bounded tools, no Provider Manager');
