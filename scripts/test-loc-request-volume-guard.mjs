import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');

test('keyword writes use one server-authorized request without permission preflight',()=>{
  const browser=read('app/loc/keyword-service-client.mjs');
  const server=read('functions/api/keywords.js');
  assert.doesNotMatch(browser,/locDelegation\(/);
  assert.doesNotMatch(browser,/fetch\('\/api\/loc-permissions'/);
  assert.match(browser,/fetch\('\/api\/keywords'/);
  assert.match(server,/verifiedIdentity\(request,context\.env\)/);
  assert.match(server,/locPermissionsForEmail\(db,claims\.email\)/);
  assert.match(server,/if\(!owner\)error\('Scope Keyword management permission required',403\)/);
});

test('browser verified session deduplicates consumers and never polls',()=>{
  const auth=read('app/loc/auth/loc-browser.mjs');
  assert.match(auth,/let verifiedSessionPromise=null/);
  assert.match(auth,/if\(!verifiedSessionPromise\)/);
  assert.match(auth,/verifiedSessionPromise=pending/);
  assert.doesNotMatch(auth,/setInterval\(|setTimeout\(/);
});

test('ZModel backed browser query cache retains two hours and disables refetch',()=>{
  const resources=read('zenstack/client-queries.js');
  const shell=read('app/AppShell.jsx');
  assert.match(resources,/LOC_MIN_CACHE_TTL_MS=2\*60\*60\*1000/);
  assert.match(resources,/gcTime:LOC_MIN_CACHE_TTL_MS,staleTime:Infinity/);
  assert.match(resources,/\.\.\.rest,\.\.\.defaults,queryKey/);
  assert.match(shell,/gcTime:2\*60\*60\*1000,staleTime:Infinity/);
  for(const source of [resources,shell]){
    assert.match(source,/refetchOnMount:false/);
    assert.match(source,/refetchOnWindowFocus:false/);
    assert.match(source,/refetchOnReconnect:false/);
    assert.match(source,/refetchInterval:false/);
  }
});

test('editing keyboard activity checks are local and coalesced at 15 minutes',()=>{
  const dock=read('app/modular/edit-dock.jsx');
  assert.match(dock,/now-lastActivityCheck<15\*60\*1000/);
  assert.match(dock,/touchEditorSession\(window\.sessionStorage,now\)/);
  assert.doesNotMatch(dock,/setInterval\(/);
});
