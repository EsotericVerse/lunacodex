import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const gateway=fs.readFileSync('supabase/functions/loc-kysely/index.ts','utf8');
const publicProvider=fs.readFileSync('app/loc/providers/kysely-public.mjs','utf8');

test('cross-engine public actions use native Kysely, never old RPC',()=>{
  assert.match(gateway,/body\.kind==="public-action".*executeKyselyPublicAction\(trx,body/);
  assert.match(publicProvider,/introspection\.getTables\(/);
  assert.doesNotMatch(publicProvider,/to_regclass\(/);
});

test('public-action on MySQL and SQL Server is routed before the private query ACL',()=>{
  const portable=gateway.slice(gateway.indexOf('if(target.provider==="custom"'));
  assert.match(portable,/body\.kind==="public-action"/);
  assert.ok(portable.indexOf('body.kind==="public-action"')<
    portable.indexOf('authorizeCrossEngineQuery(trx,body'));
});
