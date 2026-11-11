import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolveLocPermissions} from '../app/loc/permissions/roles.mjs';
const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('LOC Auth delegates OIDC, OAuth, JWT and storage to Better Auth',()=>{
 const auth=source('workers/loc-authority/auth.mjs');
 const entry=source('workers/loc-authority/index.mjs');
 assert.match(auth,/betterAuth\(/);
 assert.match(auth,/oauthProvider\(/);
 assert.match(auth,/jwt\(/);
 assert.match(auth,/PostgresDialect/);
 assert.match(auth,/schemaName:env.LOC_AUTH_SCHEMA/);
 assert.match(auth,/Approved LOC Auth PostgreSQL schema is not configured/);
 assert.doesNotMatch(auth,/schemaName:'loc_auth'|runMigrations|CREATE TABLE|LOC_AUTH_SCHEMA_GENERATION/);
 // All declared Auth storage models are Rainbow-prefixed and never written to
 // an unreviewed PostgreSQL schema on deployment.
 const declared=Object.fromEntries([...auth.matchAll(/^  ([A-Za-z]+):'(rainbow_[a-z_]+)',?$/gm)].map(m=>[m[1],m[2]]));
 for(const key of ['user','session','account','verification','jwks','oauthClient',
   'oauthResource','oauthClientResource','oauthRefreshToken',
   'oauthAccessToken','oauthConsent','oauthClientAssertion'])
   assert.match(declared[key]||'',/^rainbow_/,'missing Rainbow mapping: '+key);
 assert.match(auth,/user:\{modelName:RAINBOW_TABLES\.user\}/);
 assert.match(auth,/session:\{modelName:RAINBOW_TABLES\.session/);
 assert.match(auth,/account:\{modelName:RAINBOW_TABLES\.account/);
 assert.match(auth,/verification:\{modelName:RAINBOW_TABLES\.verification\}/);
 assert.match(auth,/schema:\{jwks:\{modelName:RAINBOW_TABLES\.jwks\}\}/);
 assert.match(auth,/oauthClient:\{modelName:RAINBOW_TABLES\.oauthClient\}/);
 assert.match(entry,/oauthProviderOpenIdConfigMetadata/);
 assert.match(entry,/oauthProviderAuthServerMetadata/);
 assert.doesNotMatch(entry,/native-oauth|runBetterAuthStore|LocAuthorityState|signLocDelegation/);
 assert.doesNotMatch(auth,/createAdapterFactory|DurableObject|native-session|native-token/);
});
test('public website data path does not request an Auth token',()=>{
 const db=source('app/loc/mcp/native-kysely.mjs');
 const website=source('app/loc/providers/configured.mjs');
 assert.doesNotMatch(db,/auth\.lo3rwang\.cc|LOC_DB_PROFILE_SERVICE_TOKEN/);
 assert.doesNotMatch(website,/\/v1\/delegation|access_token|LOC_DB_PROFILE_SERVICE_TOKEN/);
 assert.match(website,/createKyselyPublicClient/);
 assert.match(website,/credentials:'include'/);
});
test('role authorization uses only the active existing api.manage rows',()=>{
 const active=[
  {id:'admin',email:'sopa2306@gmail.com',manage_role:'admin',active:false},
  {id:'lo3rwang',email:'sopa2306@gmail.com',manage_role:'admin',active:true},
  {id:'loc',email:'sopa2306@gmail.com',manage_role:'group',active:true},
  {id:'lrunes',email:'sopa2306@gmail.com',manage_role:'scope',active:true}
 ];
 const owner=resolveLocPermissions('SOPA2306@gmail.com',active);
 assert.equal(owner.canWrite,true);
 assert.equal(owner.canManage,true);
 assert.ok(owner.grants.includes('global:manage'));
 assert.ok(owner.grants.includes('lrunes:write'));
 assert.deepEqual(owner.roles.find(r=>r.id==='lrunes')?.role,'scope');
 assert.deepEqual(owner.roles.find(r=>r.id==='loc')?.role,'group');
 assert.equal(resolveLocPermissions('other@example.com',active).canWrite,false);
 assert.equal(resolveLocPermissions('sopa2306@gmail.com',[active[0]]).canWrite,false);
});
test('the Auth Worker has no former Durable Object binding',()=>{
 const config=source('workers/loc-authority/wrangler.jsonc');
 assert.doesNotMatch(config,/LOC_AUTHORITY_STATE|durable_objects/);
 assert.match(config,/nodejs_compat/);
});

test('Pages routes expose independent permissions and business write handlers',()=>{
 const routes=JSON.parse(source('public/_routes.json'));
 for(const path of ['/api/loc-permissions','/api/loc-native','/api/loc-public-query','/api/loc-public-content'])
   assert.ok(routes.include.includes(path),'missing public Pages handler: '+path);
 assert.equal(routes.include.includes('/api/loc-authority-role'),false);
});

test('rewrite does not restore row-count limits to public reads or calculation',()=>{
 const browser=source('app/loc/providers/kysely-browser.mjs');
 const sqlPublic=source('app/loc/server/native-public-query.mjs');
 const config=source('app/loc/query-batch-size.mjs');
 assert.match(browser,/this\.rowLimit=null/);
 assert.doesNotMatch(browser,/rowLimit=queryBatchSize/);
 assert.doesNotMatch(sqlPublic,/MAX_PUBLIC_GROUPS|maxPublicGroups/);
 assert.match(config,/MAX_ROWS=1000/);
});

test('LOC Auth never silently creates or adopts a test storage namespace',()=>{
 const auth=source('workers/loc-authority/auth.mjs');
 assert.doesNotMatch(auth,/schemaName:\s*['"`]loc_auth['"`]/);
 assert.match(auth,/LOC_AUTH_SCHEMA/);
 assert.match(auth,/namespace==='loc_auth'/);
 assert.match(auth,/rainbow_auth/);
});
test('LOC Auth Session cookie cache is deployment-versioned and separate from website permissions',()=>{
 const auth=source('workers/loc-authority/auth.mjs');
 const config=JSON.parse(source('workers/loc-authority/wrangler.jsonc'));
 assert.match(auth,/cookieCache:locAuthSessionCache\(env\)/);
 assert.match(auth,/storeSessionInDatabase:true/);
 assert.match(auth,/maxAge:30\*60/);
 assert.match(auth,/CF_VERSION_METADATA\?\.id/);
 assert.equal(config.version_metadata.binding,'CF_VERSION_METADATA');
  // Inspect Auth runtime code only; comments may reference independent business rights.
  const implementation=auth.slice(auth.indexOf('export function createLocAuth(env){'));
 assert.doesNotMatch(implementation,/api\.manage|scopeid|locPermissionsForEmail/);
});

test('Rainbow OAuth client registration is owner-gated; Galaxy-Link uses CIMD',()=>{
 const auth=source('workers/loc-authority/auth.mjs');
 const extension=source('extensions/loc-galaxy-link/background.js');
 const cfg=JSON.parse(source('public/extension/oauth/config.json'));
 const metadata=JSON.parse(source('public/extension/oauth/client.json'));
 assert.ok(auth.includes('allowDynamicClientRegistration:true'));
 assert.ok(auth.includes('allowUnauthenticatedClientRegistration:false'));
 assert.equal(metadata.client_id,cfg.client_id);
 assert.ok(metadata.redirect_uris.includes(
  'https://hiaeafonocnjaclcfgjmdopbcgnafnna.chromiumapp.org/loc'));
 for(const scope of cfg.scope.split(' '))
   assert.ok(metadata.scope.split(' ').includes(scope),'CIMD missing scope: '+scope);
 assert.ok(extension.includes('cfg.client_id=registeredClient(cfg,redirect);'));
 assert.ok(!extension.includes('fetch(config.registration_endpoint'));
 assert.ok(!extension.includes('locRegisteredOAuthClient'));
});

test('privileged business operations bypass Cookie Cache and require import scope',()=>{
 const native=source('app/loc/mcp/native-operations.mjs');
 const server=source('app/loc/auth/verified-session.mjs');
 assert.ok(native.includes('get-session?disableCookieCache=true'));
 assert.ok(server.includes('get-session?disableCookieCache=true'));
 assert.ok(native.includes("delegatedScopes:String(claims.scope||'')"));
 assert.ok(native.includes("!claims.delegatedScopes?.includes('loc:import')"));
 assert.ok(native.includes('writeKinds.has(body.kind)'));
 assert.ok(native.includes('locPermissionsForEmail(selected.db,claims.email)'));
});

test('OpenID and OAuth discovery serve root and issuer-path metadata',()=>{
 const entry=source('workers/loc-authority/index.mjs');
 assert.ok(entry.includes("url.pathname==='/.well-known/oauth-authorization-server/api/auth'"));
 assert.ok(entry.includes("url.pathname==='/api/auth/.well-known/openid-configuration'"));
 assert.ok(entry.includes('oauthProviderAuthServerMetadata(auth)'));
 assert.ok(entry.includes('oauthProviderOpenIdConfigMetadata(auth)'));
});
