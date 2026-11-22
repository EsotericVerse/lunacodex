import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {publishedLocAccess} from '../app/loc/permissions/loc-business-grants.mjs';
import {readLocAccess,loc_access} from '../app/loc/permissions/loc_access.mjs';
import {locAccessRows,bindLocAuthorization} from '../app/loc/providers/loc-authorization.mjs';
import {readLocEditorGrants} from '../app/loc/auth/editor-grants.mjs';

const source=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');

test('published business grants need neither an open database nor an HTTP request',async()=>{
  const verified='sopa2306@gmail.com';
  const expected=publishedLocAccess(verified,{website:true});
  assert.equal(expected.canWrite,true);
  assert.equal(expected.canManage,true);
  assert.ok(expected.grants.includes('global:manage'));
  const noSql={selectFrom(){throw Error('api.manage lookup must never run');}};
  assert.deepEqual(await readLocAccess(noSql,verified,{website:true,transactional:true}),expected);
  assert.deepEqual(await readLocAccess(null,verified,{website:true}),expected);
  assert.deepEqual(await readLocAccess(noSql,'unknown@example.org',{website:true}),
    {canWrite:false,canManage:false,grants:[],roles:[]});
  assert.equal(loc_access(verified,[],{website:true}).canWrite,false);
});

test('management UI derives roles using the existing verified Auth Session',async()=>{
  const result=await readLocEditorGrants({sessionProvider:async()=>({
    user:{id:'USER_ONE',email:'sopa2306@gmail.com'},
    oauth:{email:'sopa2306@gmail.com'}
  })});
  assert.equal(result.user.id,'USER_ONE');
  assert.equal(result.roles.length,4);
  assert.ok(result.grants.includes('global:manage'));
  await assert.rejects(readLocEditorGrants({sessionProvider:async()=>null}),/authentication required/);
});

test('trusted role self projection reads only published JS, including birthday',async()=>{
  const broken={selectFrom(){throw Error('No SQL role SELECT allowed');}};
  bindLocAuthorization(broken,{role:'authenticated',claims:{
    provider:'loc',me:true,sub:'USER_ONE',email:'sopa2306@gmail.com',
    grants:publishedLocAccess('sopa2306@gmail.com',{website:true}).grants
  }});
  const rows=await locAccessRows(broken,'self');
  assert.ok(rows.some(row=>row.id==='lo3rwang'&&row.allowed===true));
  assert.ok(rows.some(row=>row.id==='loc'&&row.birthday));
});

test('self-only JS grants and named transactions are enabled without a generic SELECT route',()=>{
  const routes=JSON.parse(source('public/_routes.json'));
  assert.ok(routes.include.includes('/api/loc-permissions'));
  assert.ok(routes.include.includes('/api/loc-public-query'));
  assert.match(source('functions/api/loc-permissions.js'),/handleLocSelfPermissions/);
  assert.match(source('functions/api/loc-public-query.js'),/handleNamedPublicTransaction/);
  assert.doesNotMatch(source('app/loc/server/public-named-transactions.mjs'),
    /req\.schema|req\.table|body\.columns|body\.filters|body\.sql/);
  assert.doesNotMatch(source('app/loc/auth/editor-grants.mjs'),/\/api\/loc-permissions|fetchImpl/);
  assert.doesNotMatch(source('app/loc/permissions/loc_access.mjs'),/selectFrom\('api\.manage'\)/);
  assert.doesNotMatch(source('app/loc/providers/loc-authorization.mjs'),/selectFrom\('api\.manage/);
});
