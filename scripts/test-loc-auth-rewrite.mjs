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
 assert.match(auth,/schemaName:'loc_auth'/);
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
 assert.equal(resolveLocPermissions('other@example.com',active).canWrite,false);
 assert.equal(resolveLocPermissions('sopa2306@gmail.com',[active[0]]).canWrite,false);
});
test('the Auth Worker has no former Durable Object binding',()=>{
 const config=source('workers/loc-authority/wrangler.jsonc');
 assert.doesNotMatch(config,/LOC_AUTHORITY_STATE|durable_objects/);
 assert.match(config,/nodejs_compat/);
});
