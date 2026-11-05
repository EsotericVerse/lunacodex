import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('SQL Gateway verifies each JWT but caches only Authority identity for matching Clerk Session',()=>{
  const edge=readFileSync(new URL('../supabase/functions/loc-kysely/index.ts',import.meta.url),'utf8');
  assert.match(edge,/createVerifiedSessionEmailCache/);
  assert.match(edge,/await jwtVerify\(token,clerkKeys/);
  assert.match(edge,/await sessionEmailCache\(\{issuer:payload\.iss,subject:payload\.sub,session:payload\.sid\}/);
  assert.match(edge,/identity\.session!==payload\.sid/);
});

test('LOC SQL Gateway accepts Clerk/Authority, not Supabase Auth sessions',()=>{
  const edge=source('supabase/functions/loc-kysely/index.ts');
  assert.match(edge,/verifyClerkForSql\(token\)/);
  assert.match(edge,/verifyMcpForSql\(token,/);
  assert.match(edge,/LOC requires a verified Clerk session/);
  assert.doesNotMatch(edge,/authClient\.auth\.getUser\(token\)/);
  assert.doesNotMatch(edge,/createClient\(supabaseUrl,\s*apiKey/);
});
test('configured production adapter keeps Clerk separate from database driver identity',()=>{
  const gateway=source('app/loc/providers/clerk-gateway.mjs');
  const configured=source('app/loc/providers/configured.mjs');
  assert.match(gateway,/createClerkAccountAdapter/);
  assert.match(gateway,/getAccessToken/);
  assert.match(configured,/return createClerkGatewayAdapter\(\)/);
  assert.doesNotMatch(configured,/createNeonPrimaryAdapter/);
});
test('non-Postgres SQL paths re-check LOC blacklist and Registry ownership',()=>{
  const port=source('app/loc/providers/sql-engine-ports.mjs');
  assert.match(port,/selectFrom\('silver\.loc'\)\.select\('blacklist'\)/);
  assert.match(port,/selectFrom\('silver\.manage'\)/);
  assert.match(port,/db\.fn\('lower',\['email'\]\)/);
  assert.match(port,/LOC identity is blocked/);
});

test('public database requests use the configured Kysely primary, not pinned Supabase Data API',()=>{
  const gateway=source('app/loc/providers/clerk-gateway.mjs');
  assert.match(gateway,/publicClient:publicSql/);
  assert.match(gateway,/configuredPublicClient:publicSql/);
  assert.match(gateway,/realtimeClient:publicSdk/);
});
