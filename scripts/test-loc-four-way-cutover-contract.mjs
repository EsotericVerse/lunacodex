import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('LOC Auth issuer, website audience and MCP audience are distinct',()=>{
 const native=read('workers/loc-authority/native-oauth.mjs');
 const authority=read('workers/loc-authority/index.mjs');
 const mcp=read('app/loc/mcp/router.mjs');
 assert.match(native,/export const ISSUER='https:\/\/auth\.lo3rwang\.cc'/);
 assert.match(native,/export const MCP_AUDIENCE='https:\/\/mcp\.lo3rwang\.cc'/);
 assert.match(native,/export const WEB_AUDIENCE='https:\/\/loc\.lo3rwang\.cc'/);
 assert.match(native,/const EXT_CLIENT=WEB_AUDIENCE\+'\/extension\/oauth\/client\.json'/);
 assert.match(native,/const EXT_REDIRECT='https:\/\/[a-p]{32}\.chromiumapp\.org\/loc'/);
 assert.match(native,/path==='\/oauth\/revoke'/);
 assert.match(authority,/if\(isNativeOAuthPath\(target\.pathname\)\)return handleNativeOAuth/);
 assert.match(authority,/verifyNativeOAuth\(request,env,MCP_AUDIENCE\)/);
 assert.match(mcp,/https:\/\/mcp\.lo3rwang\.cc/);
 assert.match(mcp,/LOC_OAUTH_ISSUER='https:\/\/auth\.lo3rwang\.cc'/);
});

test('Cloudflare Pages root MCP route and discovery endpoints are enabled',()=>{
 const routes=JSON.parse(read('public/_routes.json'));
 for(const p of ['/','/mcp','/.well-known/oauth-protected-resource',
   '/.well-known/oauth-protected-resource/mcp'])
  assert.ok(routes.include.includes(p),'Missing Pages function route: '+p);
 const handler=read('functions/index.js');
 assert.match(handler,/hostname==='mcp\.lo3rwang\.cc'/);
 assert.match(handler,/return handleMcp\(context\.request,context\.env\)/);
 assert.match(handler,/return context\.next\(\)/);
});

test('Chrome native PKCE and website capture keep independent, durable Queues',()=>{
 const config=JSON.parse(read('public/extension/oauth/config.json'));
 assert.equal(config.issuer,'https://auth.lo3rwang.cc');
 assert.equal(config.resource,'https://auth.lo3rwang.cc/v1/import/short');
 assert.equal(config.import_url,config.resource);
 assert.ok(config.scope.split(/\s+/).includes('loc:import'));
 const chrome=read('extensions/loc-galaxy-link/background.js');
 const capture=read('extensions/loc-web-capture-v2/background.js');
 const manifest=JSON.parse(read('extensions/loc-galaxy-link/manifest.json'));
 assert.ok(manifest.host_permissions.includes('https://auth.lo3rwang.cc/*'));
 assert.match(chrome,/chrome\.identity\.launchWebAuthFlow/);
 assert.match(chrome,/registeredClient\(/);
 assert.match(chrome,/disconnectLoc\(/);
 assert.match(chrome,/validateArticleReceipts\(/);
 assert.match(chrome,/await acknowledgeBatch\(records\)/);
 assert.match(capture,/window\.__locGalaxyLinkImport/);
 const queueName=text=>text.match(/const DB_NAME='([^']+)'/)?.[1];
 assert.ok(queueName(chrome)&&queueName(capture)&&queueName(chrome)!==queueName(capture));
});

test('independent SQL requires server-only DB alias and signed LOC delegation',()=>{
 const main=read('services/loc-sql/main.ts');
 const handler=read('app/loc/gateway/sql-handler.ts');
 const docker=read('Dockerfile');
 assert.match(main,/LOC_CONTROL_DB_ALIAS/);
 assert.match(main,/LOC_CONTROL_DB_ENGINE/);
 assert.match(main,/LOC_DB_CONNECTIONS_JSON/);
 assert.match(handler,/verifyLocDelegation\(match\[1\],body\)/);
 assert.match(handler,/portableShortImportStore\(db,sql,\{engine:target\.engine,/);
 assert.match(handler,/resolveRuntimeDatabase\(/);
 assert.match(read('workers/loc-authority/index.mjs'),/selectedDatabaseForDelegation\(/);
 assert.match(read('workers/loc-authority/sql-profile.mjs'),/trustedSqlProfile/);
 assert.match(docker,/^FROM denoland\/deno:/m);
 assert.match(docker,/^COPY app \.\/app$/m);
 assert.match(docker,/^COPY zenstack \.\/zenstack$/m);
 assert.doesNotMatch(main,/SUPABASE_DB_URL|NEON_DATABASE_URL|clerk-browser/);
});

test('only main may auto-deploy on Vercel and documentation-only builds skip',()=>{
 const config=JSON.parse(read('vercel.json'));
 assert.equal(config.git?.deploymentEnabled?.main,true);
 assert.equal(config.git?.deploymentEnabled?.['*'],false);
 assert.match(config.ignoreCommand||'',/git diff --name-only/);
});
