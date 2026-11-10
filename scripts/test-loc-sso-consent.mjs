import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {approvedConsent,recordConsent,revokeConsent,consentPage,
 DATA_CONTRACT_VERSION} from '../workers/loc-authority/oauth-consent.mjs';
import {readFileSync} from 'node:fs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const subject='loc_'+'A'.repeat(40);
const client='loc-mcp-'+('B'.repeat(43));
const resource='https://auth.lo3rwang.cc/v1/import/short';
const stub=()=>{const values=new Map();return {
 nativeGet:async k=>values.get(k),
 nativePut:async(k,v)=>{values.set(k,v);return true},
 nativeTake:async k=>{const v=values.get(k);values.delete(k);return v},
 values
}};
test('one explicit grant is reusable for the same client, Subject, resource and subset of Scopes',async()=>{
 const state=stub();
 assert.equal(await approvedConsent(state,subject,client,resource,'loc:import'),false);
 await recordConsent(state,subject,client,resource,'loc:import');
 assert.equal(await approvedConsent(state,subject,client,resource,'loc:import'),true);
 assert.equal(await approvedConsent(state,subject,client,resource,'loc:import offline_access'),false);
 await recordConsent(state,subject,client,resource,'loc:import offline_access');
 assert.equal(await approvedConsent(state,subject,client,resource,'loc:import'),true);
 assert.equal(await approvedConsent(state,subject,client,resource,'loc:import offline_access'),true);
 assert.equal(await approvedConsent(state,subject+'x',client,resource,'loc:import'),false);
 assert.equal(await approvedConsent(state,subject,client+'x',resource,'loc:import'),false);
 assert.equal(await approvedConsent(state,subject,client,resource+'/other','loc:import'),false);
 const saved=[...state.values.values()][0];
 assert.equal(saved.version,DATA_CONTRACT_VERSION);
 assert.ok(saved.acceptedAt);
});
test('revocation clears future approval; scope changes and unknown scopes cannot be granted',async()=>{
 const state=stub();
 await recordConsent(state,subject,client,resource,'loc:import');
 await revokeConsent(state,subject,client,resource);
 assert.equal(await approvedConsent(state,subject,client,resource,'loc:import'),false);
 await assert.rejects(recordConsent(state,subject,client,resource,'loc:write-everything'),/Invalid OAuth consent scopes/);
});
test('data contract displays exact permission details safely, no implicit approval button',()=>{
 const markup=consentPage({nonce:'n'.repeat(43),
  clientName:'<script>alert(1)</script>',scope:'loc:import offline_access',
  resource,identity:'user@example.org'});
 assert.match(markup,/展開資料合約/);
 assert.match(markup,/api.manage/);
 assert.match(markup,/value="approve"/);
 assert.match(markup,/value="deny"/);
 assert.match(markup,/&lt;script&gt;/);
 assert.doesNotMatch(markup,/<script>alert/);
 assert.match(markup,/loc-oauth-data-contract-v1/);
});
test('write-delegation endpoint requires accepted web contract and editor can return to approval',()=>{
 const auth=readFileSync(new URL('../workers/loc-authority/index.mjs',import.meta.url),'utf8');
 const grants=readFileSync(new URL('../app/loc/auth/editor-grants.mjs',import.meta.url),'utf8');
 assert.match(auth,/approvedConsent\(stub,principal\.subject,'loc-web'/);
 assert.match(auth,/status:428|},428,origin/);
 assert.match(grants,/response\.status===428/);
 assert.match(grants,/\/oauth\/consent\/web/);
});
test('fixed primary accepts owner Cloudflare Secret and external targets retain Authority',()=>{
 const driver=readFileSync(new URL('../app/loc/mcp/native-kysely.mjs',import.meta.url),'utf8');
 assert.match(driver,/LOC_DATABASE_URL/);
 assert.match(driver,/deployedMainProfile/);
 assert.match(driver,/\/v1\/internal\/database\//);
 assert.match(driver,/PostgresDialect/);
});

test('control DB and signed loc-main share the Kysely pool from LOC Authority',async()=>{
 const {directMcpKysely,mcpDatabaseConfiguration}=
  await import('../app/loc/mcp/native-kysely.mjs');
 const env={LOC_DB_PROFILE_SERVICE_TOKEN:'local-profile-secret-32-characters-or-more'};
 assert.equal(mcpDatabaseConfiguration(env).publicReadConfigured,false);
 assert.equal(mcpDatabaseConfiguration(env).privateReadConfigured,true);
 const requests=[];
 const fetchImpl=async(url)=>{
  requests.push(url);
  return Response.json({engine:'postgres',host:'db.example.net',port:5432,
   database:'loc',username:'reader',password:'test-only-password',
   schema_name:'silver'});
 };
 const defaultDb=await directMcpKysely(env,'',{fetchImpl});
 const selectedDb=await directMcpKysely(env,'loc-main',{fetchImpl});
 assert.strictEqual(defaultDb.db,selectedDb.db,
  'signed primary and public reader must share one database pool');
 assert.equal(defaultDb.engine,'postgres');
 assert.equal(defaultDb.namespace,'silver');
 assert.equal(requests.length,2);
 assert.ok(requests.every(url=>url.endsWith('/v1/internal/database/primary')));
 await defaultDb.db.destroy();
});
