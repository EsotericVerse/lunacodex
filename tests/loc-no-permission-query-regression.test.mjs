import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {loadMcpLocAccess,authorizeMcpRole} from '../app/loc/mcp/access-roles.mjs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('MCP business role checks never open SQL or read api.manage',async()=>{
  const forbidden={selectFrom(){throw Error('SQL role lookup forbidden');}};
  const rights=await loadMcpLocAccess(forbidden,'sopa2306@gmail.com');
  assert.equal(rights.canWrite,true);
  assert.equal(rights.canManage,false);
  const response=await authorizeMcpRole('sopa2306@gmail.com');
  assert.ok(response.permissions.grants.includes('loc:write'));
  assert.doesNotMatch(read('app/loc/mcp/access-roles.mjs'),/directMcpKysely|closeLocDatabase|selectFrom/);
});

test('no standalone permission or Scope status HTTP operations survive',()=>{
  const native=read('app/loc/mcp/native-operations.mjs');
  assert.doesNotMatch(native,/'mcp-authorize'|'mcp-scope-status'/);
  assert.doesNotMatch(native,/selectFrom\('api\.manage'\)/);
  const managed=read('app/loc/providers/kysely-management.mjs');
  assert.doesNotMatch(managed,/selectFrom\('api\.manage'\)/);
});

test('named LOC transactions remain available without a general SELECT executor',()=>{
  assert.equal(existsSync(new URL('../app/loc/server/native-public-query.mjs',import.meta.url)),false);
  const routes=JSON.parse(read('public/_routes.json'));
  assert.ok(routes.include.includes('/api/loc-public-query'));
  const named=read('app/loc/server/public-named-transactions.mjs');
  assert.ok(named.includes('executeKyselyAnalytics('));
  assert.ok(named.includes('executeKyselyPublicAction('));
  assert.ok(!named.includes('handleNativePublicQuery'));
  assert.ok(!named.includes('native-public-query.mjs'));
});

test('Manage changes cannot commit a role or route different from published JS',()=>{
  const native=read('app/loc/mcp/native-operations.mjs');
  assert.match(native,/requirePublishedManageWrite\(body\.payload\)/);
  assert.match(native,/for\(const item of body\.operations\|\|\[\]\)requirePublishedManageWrite\(item\)/);
  assert.match(native,/Object\.is\(fixed\[field\],value\)/);
  const lifecycle=read('app/loc/providers/kysely-scope-lifecycle.mjs');
  assert.match(lifecycle,/fixedManageScope\(id\)\?\.active===true/);
});

test('Statistics and public Search use published Scope JS, never api.manage SQL',()=>{
  const analytics=read('app/loc/providers/kysely-analytics.mjs');
  assert.doesNotMatch(analytics,/selectFrom\('api\.manage'\)|zmodelRegistryJoin/);
  assert.match(analytics,/publishedManagedScope\(scope\)/);
  assert.match(analytics,/FIXED_MANAGE_ROWS\.filter/);
});

test('Registry writes cannot silently outrun the published JS route',()=>{
  const lifecycle=read('app/loc/providers/kysely-scope-lifecycle.mjs');
  assert.match(lifecycle,/Publish matching JS Scope routing before Registry update/);
});
