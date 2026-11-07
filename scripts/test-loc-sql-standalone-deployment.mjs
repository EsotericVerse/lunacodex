import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('the LOC Deno SQL service validates its own alias, never a vendor login',()=>{
  const service=read('services/loc-sql/main.ts');
  const handler=read('app/loc/gateway/sql-handler.ts');
  assert.match(service,/LOC_CONTROL_DB_ALIAS/);
  assert.match(service,/LOC_DB_CONNECTIONS_JSON/);
  assert.match(service,/gateway\/sql-handler\.ts/);
  assert.doesNotMatch(service,/SUPABASE_DB_URL|NEON_DATABASE_URL|clerk-browser/);
  assert.match(handler,/pathname === "\/health"/);
  assert.match(handler,/status: 204/);
  assert.ok(handler.indexOf('pathname === "/health"')<handler.indexOf('request.method !== "POST"'));
});
test('Cloudflare ingress keeps health private, forwards signed SQL unchanged',()=>{
  const config=JSON.parse(read('services/loc-sql/wrangler.jsonc'));
  const worker=read('services/loc-sql/cloudflare-worker.mjs');
  const docker=read('services/loc-sql/Dockerfile');
  assert.equal(config.name,'loc-sql');
  assert.equal(config.containers[0].images.base.build_context,'../..');
  assert.equal(config.durable_objects.bindings[0].class_name,'LocSqlContainer');
  assert.ok(!Object.hasOwn(config.vars,'LOC_DB_CONNECTIONS_JSON'));
  assert.match(worker,/url\.protocol='http:'/);
  assert.match(worker,/url\.host='container'/);
  assert.match(worker,/new Request\(url,request\)/);
  assert.match(worker,/url\.pathname!=='\/v1\/sql'/);
  assert.match(worker,/if\(REQUIRED\.some\(name=>!env\[name\]\)\)/);
  assert.match(worker,/port\.fetch\('http:\/\/container\/health'/);
  assert.match(docker,/COPY zenstack \.\/zenstack/);
  assert.match(docker,/deno cache --config services\/loc-sql\/deno\.json/);
});
test('website and ISR use the same independent SQL URL without provider credentials',()=>{
  const server=read('app/api/loc/_server.js');
  const browser=read('app/loc/providers/configured.mjs');
  assert.match(server,/NEXT_PUBLIC_LOC_SQL_GATEWAY_URL/);
  assert.match(server,/url:SQL_GATEWAY_URL\?'':SQL_PROVIDER_URL/);
  assert.match(server,/publishableKey:SQL_GATEWAY_URL\?'':PUBLIC_KEY/);
  assert.match(server,/gatewayUrl:backupGatewayUrl/);
  assert.doesNotMatch(server,/NEON_AUTH_URL|token\/anonymous|@supabase\/postgrest-js/);
  assert.match(browser,/url=gatewayUrl\?'':/);
  assert.match(browser,/publishableKey=gatewayUrl\?'':/);
});

test('standalone short import uses the portable Kysely backend',()=>{
  const handler=read('app/loc/gateway/sql-handler.ts');
  const store=read('app/loc/import/short-append-service.mjs');
  const mcp=read('services/loc-mcp-sql/main.ts');
  assert.match(handler,/store:portableShortImportStore\(db,sql,\{engine:controlTarget\.engine\}\)/);
  assert.doesNotMatch(handler,/postgresShortImportStore/);
  assert.match(store,/export function portableShortImportStore/);
  assert.match(mcp,/portableShortImportStore\(db,sql,\{engine,namespace\}\)/);
});
