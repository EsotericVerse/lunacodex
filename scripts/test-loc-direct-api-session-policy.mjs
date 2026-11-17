import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('Scope Group permission display reuses the shared Session authorization',()=>{
  const panel=source('app/loc/scope/ScopeGroupAccessPanel.jsx');
  const account=source('app/loc/auth/use-account.js');
  assert.match(panel,/useAccount\(\)/);
  assert.match(panel,/account\.canLocAccessSync\('group'/);
  // Match executable fetch calls, not a comment that names the old endpoint.
  assert.doesNotMatch(panel,/\b(?:globalThis\.)?fetch\s*\(/);
  assert.doesNotMatch(panel,/\b(?:setItem|grant)\s*\(/);
  assert.match(account,/loadManagementAccount\(queryClient/);
  assert.match(account,/readVerifiedManagementEntry\(\)/);
});

test('Search reuses verified Session and rechecks only when unavailable',()=>{
  const search=source('app/modular/features/Search.jsx');
  assert.match(search,/const current=readVerifiedManagementEntry\(\)/);
  assert.match(search,/account\.user&&account\.email/);
  assert.match(search,/:await getAccountSession\(\)\.catch\(\(\)=>null\)/);
  assert.match(search,/const verified=readVerifiedManagementEntry\(\)\|\|/);
  assert.match(search,/await account\.refresh\(\{forceVerify:true\}\)/);
  assert.match(search,/if\(adminSearchActive\|\|adminSwitchExplicit\)/);
  assert.doesNotMatch(search,/const searchRunner=managerAtSearch\?searchAuthorizedGalaxyRows/);
});

test('HTTP read caches remain separate from protected writes and fresh editor reads',()=>{
  const reads=source('app/loc/db/db-query.mjs');
  const scope=source('app/loc/scope/scope-data.js');
  const configured=source('app/loc/providers/configured.mjs');
  const keywords=source('app/loc/keywords/service-client.mjs');
  const sessions=source('app/loc/auth/editor-grants.mjs');
  assert.match(reads,/if\(authenticated\|\|signal\|\|expectedDbId/);
  assert.match(reads,/return getOrLoadScopedRead\(table,signature/);
  assert.match(scope,/return cachedRead\('scope-config:'/);
  assert.match(scope,/export async function selectLiveScopeBlocks/);
  assert.match(configured,/readOnly=kind==='personal-read'/);
  assert.match(configured,/invalidateScopedReadCache\(payload\?\.p_table\)/);
  assert.match(keywords,/const write=\['analyze','reset','saveItem','deleteItem','syncLibrary'\]/);
  assert.match(keywords,/invalidateScopedReadCache\('silver\.'\+scope\+'_anchor'\)/);
  assert.match(sessions,/cache:'no-store'/);
});
