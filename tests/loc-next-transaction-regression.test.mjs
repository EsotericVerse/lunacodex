import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('Next App Router and React retain ownership of LOC interactive pages',()=>{
  const pkg=JSON.parse(read('package.json'));
  assert.equal(pkg.scripts.dev,'next dev');
  assert.equal(pkg.scripts.build,'next build');
  assert.ok(pkg.dependencies.next&&pkg.dependencies.react&&pkg.dependencies['react-dom']);
  assert.equal(pkg.dependencies.preact,undefined);
  assert.match(read('app/layout.jsx'),/import AppShell from '\.\/AppShell'/);
  assert.match(read('app/AppShell.jsx'),/from 'next\/dynamic'/);
  assert.match(read('app/loc/LocApp.jsx'),/from 'next\/navigation'/);
  assert.match(read('app/loc/LocApp.jsx'),/from 'next\/dynamic'/);
  for(const route of ['app/page.jsx','app/culture/page.jsx','app/statics/page.jsx',
    'app/search/page.jsx','app/trace/page.jsx','app/lo3rwang/page.jsx']){
    assert.ok(existsSync(new URL('../'+route,import.meta.url)),route);
    assert.equal(existsSync(new URL('../'+route.replace(/page\.jsx$/,'page.html'),import.meta.url)),false);
  }
});
test('Transaction writes survive Next navigation restoration',()=>{
  const dock=read('app/modular/edit-dock.jsx');
  const client=read('app/loc/db/db-client.mjs');
  assert.match(dock,/usePathname,useRouter/);
  assert.match(dock,/router\.push/);
  assert.match(dock,/transactionWrites/);
  assert.match(client,/transactionWrites/);
  for(const path of [
    'app/loc/providers/kysely-scope-lifecycle.mjs',
    'app/loc/providers/kysely-trace-page.mjs',
    'tests/loc-db-connectivity.test.mjs',
    'tests/loc-media-atomic-link.test.mjs'
  ])assert.ok(existsSync(new URL('../'+path,import.meta.url)),path);
});
