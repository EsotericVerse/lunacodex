import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';

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
 assert.match(handler,/return handleMcp\(context\.request,\{/);
 assert.match(handler,/locDirectDatabase:\(verifiedAlias=''\)=>directMcpKysely\(bindings,verifiedAlias\)/);
 assert.doesNotMatch(handler,/LOC_SQL_GATEWAY_URL|LOC_MCP_SQL_GATEWAY_URL/);
 assert.match(handler,/return context\.next\(\)/);
});

test('Chrome galaxy-link is the only extension: native PKCE + all capture modes, one Queue',()=>{
 const config=JSON.parse(read('public/extension/oauth/config.json'));
 assert.equal(config.issuer,'https://auth.lo3rwang.cc');
 assert.equal(config.resource,'https://auth.lo3rwang.cc/v1/import/short');
 const bg=read('extensions/loc-galaxy-link/background.js');
 const capture=read('extensions/loc-galaxy-link/content.js');
 const manifest=JSON.parse(read('extensions/loc-galaxy-link/manifest.json'));
 assert.ok(manifest.host_permissions.includes('https://auth.lo3rwang.cc/*'));
 assert.ok(manifest.permissions.includes('identity'));
 assert.equal(manifest.action.default_popup,'popup.html');
 assert.match(bg,/chrome\.identity\.launchWebAuthFlow/);
 assert.match(bg,/validateArticleReceipts/);
 assert.match(bg,/await removeEvents\(group\)/);
 assert.match(bg,/const DB_NAME='loc-channel1-queue'/);
 assert.match(capture,/MutationObserver/);
 assert.match(capture,/Readability/);
 assert.equal(existsSync(new URL('../extensions/loc-web-capture-v2/',import.meta.url)),false);
});

test('LOC never packages an independent SQL Gateway or Container',()=>{
 for(const path of [
  'Dockerfile','services/loc-sql/main.ts','services/loc-sql/Dockerfile',
  'services/loc-sql/cloudflare-worker.mjs','services/loc-sql/wrangler.jsonc',
  'services/loc-mcp-sql/main.ts','services/loc-mcp-sql/Dockerfile',
  'services/loc-mcp-sql/cloudflare-worker.mjs','services/loc-mcp-sql/wrangler.jsonc'
 ])assert.equal(existsSync(new URL('../'+path,import.meta.url)),false,path);
 const driver=read('app/loc/providers/kysely-database-drivers.ts');
 for(const dialect of ['PostgresDialect','MysqlDialect','MssqlDialect'])
  assert.match(driver,new RegExp(dialect));
 const configured=read('app/loc/providers/configured.mjs');
 assert.doesNotMatch(configured,/createLocGatewayAdapter|NEXT_PUBLIC_LOC_SQL_GATEWAY_URL/);
 const auth=read('workers/loc-authority/native-oauth.mjs');
 assert.match(auth,/PKCE|S256|code_challenge_method/);
});

test('only main may auto-deploy on Vercel and documentation-only builds skip',()=>{
 const config=JSON.parse(read('vercel.json'));
 assert.equal(config.git?.deploymentEnabled?.main,true);
 assert.equal(config.git?.deploymentEnabled?.['*'],false);
 assert.match(config.ignoreCommand||'',/git diff --name-only/);
});
