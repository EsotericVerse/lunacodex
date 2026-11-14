import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createMcpGatewayQos,MCP_QOS_BUDGET} from '../app/loc/mcp/gateway-qos.mjs';

// Exercises the actual shared LOC/Karaul request-admission implementation.
let clock=1000000;
const check=createMcpGatewayQos({now:()=>clock,detect:()=>[]});
assert.equal(MCP_QOS_BUDGET.max,120);
for(let i=0;i<MCP_QOS_BUDGET.max;i++)
  assert.equal(check('oauth-subject-a').allowed,true,'normal MCP request allowed');
const refused=check('oauth-subject-a');
assert.equal(refused.allowed,false,'excess requests receive HTTP 429 at router');
assert.ok(refused.retryAfterMs>=1000&&refused.retryAfterMs<=60000);
assert.equal(check('oauth-subject-b').allowed,true,'independent OAuth subject');
clock+=60001;
assert.equal(check('oauth-subject-a').allowed,true,'budget resets without timer');

// The router must apply the budget after verified OAuth and before dispatch.
const router=readFileSync(new URL('../app/loc/mcp/router.mjs',import.meta.url),'utf8');
const oauth=router.indexOf('if(!identity)return unauthorized(config);');
const gate=router.indexOf('const qos=checkMcpGatewayQos(identity.subject);');
const dispatch=router.indexOf('return handleStatelessMcpPost(request,async payload=>{');
assert.ok(oauth>=0&&oauth<gate&&gate<dispatch);
assert.match(router,/error:'rate_limited'/);
assert.match(router,/'Retry-After':String/);
assert.match(router,/if\(request.method==='OPTIONS'\)return preflight\(\)/);
console.log('PASS MCP bounded request QoS (120/60s), independent identities, retry-after, no timer');
