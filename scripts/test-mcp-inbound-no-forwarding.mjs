// Security boundary: inbound MCP clients can call fixed LOC tools only.
// LOC-initiated upstream provider management is a distinct authenticated API.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const from=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const router=from('../app/loc/mcp/router.mjs');
const entry=from('../functions/mcp.js');
const publicTools=[...router.matchAll(/\{name:'([^']+)',description:/g)].map(row=>row[1]);

assert.deepEqual(publicTools,[
  'loc_connection_status','read_memory','scope_storage',
  'galaxy_link','article_distribution'
]);

for(const [name,source] of [['MCP router',router],['MCP entrypoint',entry]]){
  assert.doesNotMatch(source,
    /from\s+['"][^'"]*(?:upstream-(?:tools|oauth|policy)|mcp-provider)[^'"]*['"]/,
    name+' must not import upstream provider controls');
  assert.doesNotMatch(source,
    /\b(?:invokeUpstreamTool|listUpstreamTools|beginUpstreamOAuth|requestTool)\s*\(/,
    name+' must not forward inbound traffic to outside providers');
  assert.doesNotMatch(source,/provider_(?:list|tools|call|receipt)/,
    name+' must not expose the Provider Manager over inbound MCP');
}
assert.match(router,/if\(!TOOLS\.some\(tool=>tool\.name===name\)\)/,
  'Inbound tools must be checked against the fixed allowlist');

const manager=from('../functions/api/mcp-provider.js');
assert.match(manager,/verifiedLocWebsiteSession/);
assert.match(manager,/authorizeMcpRole/);
assert.match(manager,/browserConsent\(request\)/);
assert.match(manager,/requestTool\(env,subject/,
  'Only the separate, authenticated Provider Manager can initiate provider calls');

console.log('PASS inbound MCP is isolated from external Provider Manager');
