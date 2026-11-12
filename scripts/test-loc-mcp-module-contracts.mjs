import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {WebManageRowSchema} from '../app/loc/permissions/web-manage-schema.mjs';
import {resolveManagePermissions,resolveLocPermissions}
  from '../app/loc/permissions/roles.mjs';
import {MCP_TOOL_INPUTS,mcpToolJsonSchema,parseMcpToolArgs,McpRpcSchema}
  from '../app/loc/mcp/tool-contracts.mjs';
import {ProviderControlSchema,providerArguments,providerToolName,policyMode}
  from '../app/loc/mcp/upstream-providers.mjs';

const example='scope@example.org';
const role=(name='scope',extra={})=>({
  id:'sample',email:example,manage_role:name,active:true,...extra
});
const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('ZenStack Manage ZModel generates the only live role input schema',()=>{
  assert.equal(WebManageRowSchema.safeParse(role()).success,true);
  assert.equal(WebManageRowSchema.safeParse(role('operator')).success,false);
  assert.equal(WebManageRowSchema.safeParse(role('scope',{active:false})).success,true);
  assert.equal(WebManageRowSchema.safeParse(role('scope',{extra:'injected'})).success,false);
});

test('one ZModel-derived role projection serves website, MCP and Extension',()=>{
  for(const name of ['admin','group','scope']){
    const assigned=resolveManagePermissions(example,[role(name)]);
    assert.equal(assigned.canWrite,true);
    assert.ok(assigned.grants.includes('sample:write'));
    assert.ok(assigned.grants.includes('sample:read'));
    assert.equal(assigned.grants.includes('global:manage'),name==='admin');
  }
  assert.equal(resolveManagePermissions(example,[role('scope',{active:false})]).canWrite,false);
  assert.equal(resolveManagePermissions('another@example.org',[role()]).canWrite,false);
  assert.equal(resolveLocPermissions(example,[role()]).canWrite,false,
    'website owner-only policy remains unchanged');
});

test('all eight MCP tools publish JSON Schema from their Zod runtime source',()=>{
  assert.equal(Object.keys(MCP_TOOL_INPUTS).length,8);
  for(const name of Object.keys(MCP_TOOL_INPUTS)){
    const json=mcpToolJsonSchema(name);
    assert.equal(json.type,'object',name);
    assert.ok(json.properties,name);
  }
  assert.deepEqual(mcpToolJsonSchema('galaxy_link').required,['action','scopeid']);
  assert.deepEqual(mcpToolJsonSchema('galaxy_link').properties.action.enum,
    ['search','read','check','record']);
  assert.deepEqual(mcpToolJsonSchema('read_memory').required,['uid']);
});

test('MCP Zod rejects invalid arguments before data or provider access',()=>{
  assert.equal(parseMcpToolArgs('read_memory',{uid:'ABCDEFGH'}).uid,'ABCDEFGH');
  assert.equal(parseMcpToolArgs('read_memory',{uid:'wrong'}),null);
  assert.equal(parseMcpToolArgs('scope_storage',{scopeid:'scope_123'}),null);
  assert.equal(parseMcpToolArgs('provider_call',{provider:'evil',tool:'whoami'}),null);
  assert.equal(parseMcpToolArgs('galaxy_link',{action:'read',scopeid:'sample',uid:'ABCDEFGH',source:'other'}),null);
  assert.deepEqual(parseMcpToolArgs('provider_list',{}),{});
});

test('MCP and Admin Provider requests share Zod contracts, not handwritten JSON shape checks',()=>{
  assert.equal(ProviderControlSchema.safeParse({action:'connect',provider:'github'}).success,true);
  assert.equal(ProviderControlSchema.safeParse({action:'connect',provider:'github',extra:1}).success,false);
  assert.equal(ProviderControlSchema.safeParse({action:'policy',provider:'github',tool:'whoami',mode:'ask'}).success,true);
  assert.equal(ProviderControlSchema.safeParse({action:'policy',provider:'github',tool:'whoami',mode:'allow'}).success,false);
  assert.equal(ProviderControlSchema.safeParse({action:'approve',id:'n'.repeat(30)}).success,true);
  assert.equal(ProviderControlSchema.safeParse({action:'approve',id:'not-valid'}).success,false);
  assert.equal(policyMode('deny'),'deny');
  assert.equal(providerToolName('whoami'),'whoami');
  assert.throws(()=>providerArguments({large:'x'.repeat(13000)}));
});

test('JSON-RPC protocol envelope is validated through Zod',()=>{
  assert.equal(McpRpcSchema.safeParse({jsonrpc:'2.0',id:1,method:'tools/list',params:{}}).success,true);
  assert.equal(McpRpcSchema.safeParse({jsonrpc:'1.0',id:1,method:'tools/list'}).success,false);
  assert.equal(McpRpcSchema.safeParse({jsonrpc:'2.0',method:42}).success,false);
});

test('role, Provider and native Extension routes import the actual installed model modules',()=>{
  const grants=source('app/loc/mcp/access-roles.mjs');
  const native=source('app/loc/mcp/native-operations.mjs');
  const provider=source('functions/api/mcp-provider.js');
  const router=source('app/loc/mcp/router.mjs');
  assert.match(grants,/fixedPolicyReader\(/);
  assert.match(grants,/resolveManagePermissions\(/);
  assert.match(native,/managedFiltersValid\(/);
  assert.match(native,/VerifiedLocUserInfoSchema\.safeParse\(/);
  assert.match(provider,/ProviderControlSchema\.safeParse\(/);
  assert.match(router,/mcpToolJsonSchema\(/);
  assert.match(router,/parseMcpToolArgs\(/);
});
