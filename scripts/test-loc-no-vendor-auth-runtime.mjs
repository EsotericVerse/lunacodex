import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('old vendor browser Auth SDK modules are absent from executable app',()=>{
  for(const file of [
    'app/loc/auth/clerk-browser.mjs',
    'app/loc/providers/clerk-gateway.mjs',
    'app/loc/mcp/clerk-access.mjs'
  ])assert.equal(existsSync(new URL('../'+file,import.meta.url)),false,file);
  for(const file of [
    'app/loc/providers/configured.mjs',
    'app/loc/mcp/loc-access.mjs',
    'app/loc/mcp/router.mjs',
    'public/login/index.html',
    'public/extension/website-bridge.mjs',
    'public/extension/auth-bridge.html'
  ]){
    const source=read(file);
    for(const forbidden of ['@clerk/','clerk.accounts.dev',
      'loadLocClerk','createClerkAccountAdapter'])
      assert.equal(source.includes(forbidden),false,
        file+' must not load old Auth SDK: '+forbidden);
  }
});

test('portable SQL driver is independent of Auth vendor',()=>{
  const drivers=read('app/loc/providers/kysely-database-drivers.ts');
  for(const dialect of ['PostgresDialect','MysqlDialect','MssqlDialect'])
    assert.ok(drivers.includes(dialect),dialect);
  const configured=read('app/loc/providers/configured.mjs');
  assert.ok(configured.includes('createLocAccountAdapter'));
  assert.ok(configured.includes('NEXT_PUBLIC_LOC_SQL_GATEWAY_URL'));
  assert.doesNotMatch(configured,/createClerkAccountAdapter|createSupabaseAdapter/);
});

test('retired website bridge cannot send bearer tokens into an extension',()=>{
  const code=read('public/extension/website-bridge.mjs');
  for(const forbidden of ['getToken','authorization:','sendMessage','Clerk','@clerk/'])
    assert.equal(code.includes(forbidden),false,forbidden);
});
