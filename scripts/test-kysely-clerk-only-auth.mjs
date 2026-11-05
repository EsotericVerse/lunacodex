import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('Kysely reuses verified identity for same Clerk session, never skips JWT validation',()=>{
  const edge=source('supabase/functions/loc-kysely/index.ts');
  assert.match(edge,/SESSION_IDENTITY_TTL_MS=2\*60\*60\*1000/);
  assert.match(edge,/JSON\.stringify\(\[payload\.iss,subject,sid\]\)/);
  assert.match(edge,/if\(cached&&cached\.until>now\)return cached\.pending/);
  assert.match(edge,/sessionIdentityCache\.get\(key\)\?\.pending===pending/);
  assert.match(edge,/const \{payload\}=await jwtVerify\(token,clerkKeys/);
  assert.match(edge,/identity\.subject!==payload\.sub/);
  assert.match(edge,/identity\.session!==payload\.sid/);
  assert.match(edge,/return clerkSqlClaims\(payload/);
  assert.doesNotMatch(edge,/sessionIdentityCache\.set\(token/);
});

test('LOC management snapshot uses signed Clerk Session, not JWT rotation, and stays 30 seconds',()=>{
  const auth=source('app/loc/providers/loc-authorization.mjs');
  assert.match(auth,/\['clerk-session',issuer,sub,state\.email,sid\]/);
  assert.match(auth,/\['oauth-token',issuer,sub,state\.email,exp,/);
  assert.match(auth,/PERMISSION_REUSE_MS=30_000/);
  assert.match(auth,/Math\.min\(Date\.now\(\)\+PERMISSION_REUSE_MS,Number\(state\.claims\.exp\)\*1000\)/);
  assert.match(auth,/Number\.isFinite\(exp\)\|\|exp\*1000<=Date\.now\(\)/);
  assert.match(auth,/const \{blocked,rows\}=await locPermissions\(db\)/);
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
