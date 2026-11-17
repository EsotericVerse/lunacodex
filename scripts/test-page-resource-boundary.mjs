import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('all AppShell route bodies pass through the shared pre-Hero cleanup boundary',()=>{
  const shell=read('app/AppShell.jsx');
  const boundary=read('app/modular/PageResourceBoundary.jsx');
  assert.match(shell,/import PageResourceBoundary from '\.\/modular\/PageResourceBoundary'/);
  assert.match(shell,/<PageResourceBoundary routeKey=\{scopeId\+'\|'\+normalizePath\(pathname\)\}>/);
  assert.match(shell,/\{localCoreActive&&!localWorkspace\?[\s\S]*:children\}[\s\S]*<\/PageResourceBoundary>/);
  assert.match(boundary,/useLayoutEffect/);
  assert.match(boundary,/releaseTransientPageResources\(\)/);
  assert.match(boundary,/readyKey!==key/);
  assert.match(boundary,/return children/);
});

test('resource release keeps identity, session and grant exceptions',()=>{
  const queries=read('packages/zenstack/client-queries.js');
  assert.match(queries,/const IDENTITY_KEYS=new Set/);
  assert.match(queries,/\['loc-account','session'\]/);
  assert.match(queries,/\['loc-account','management'\]/);
  assert.match(queries,/if\(IDENTITY_KEYS\.has\(key\)\)continue/);
  assert.match(queries,/isPublicBootstrapKey\(key\)&&hasReader\(key\)/);
  assert.match(queries,/function forgetStored\(key\)/);
  assert.match(queries,/bootstrapSnapshots\.release\(key\)/);
});

test('navigation gate does not change routing registry or bundled iOS paths',()=>{
  const shell=read('app/AppShell.jsx');
  const registry=read('app/modular/routing/scope-registry.js');
  assert.match(shell,/navigationHref\(item\.id,'',native\)/);
  assert.match(registry,/if\(!native\)return scopeHref\(scopeId,localPath\)/);
  assert.match(registry,/const prefix=id==='loc'\?'':isKnownScope\(id\)/);
});
