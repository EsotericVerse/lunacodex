import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {existsSync} from 'node:fs';
import {publishedLocAccess} from '../app/loc/permissions/loc-business-grants.mjs';
import {readLocAccess} from '../app/loc/permissions/loc_access.mjs';
import {loc_access} from '../app/loc/permissions/loc_access.mjs';
import {locAccessRows} from '../app/loc/providers/loc-authorization.mjs';
import {bindLocAuthorization} from '../app/loc/providers/loc-authorization.mjs';
import {readLocEditorGrants} from '../app/loc/auth/editor-grants.mjs';
import {loadMcpLocAccess} from '../app/loc/mcp/access-roles.mjs';
import {authorizeMcpRole} from '../app/loc/mcp/access-roles.mjs';
import {handleNativeLocOperation} from '../app/loc/mcp/native-operations.mjs';
import {FIXED_MANAGE_ROWS} from '../app/loc/permissions/fixed-manage-registry.mjs';
import {fixedManageScope} from '../app/loc/permissions/fixed-manage-registry.mjs';
import {publishedManagedScope} from '../app/loc/providers/published-managed-scope.mjs';
import {createLocAccountAdapter} from '../app/loc/auth/loc-browser.mjs';

{
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
  assert.equal(existsSync(new URL('../public/_routes.json',import.meta.url)),false);
  assert.equal(existsSync(new URL('../app/api/loc-public-query',import.meta.url)),false);
  assert.match(source('app/api/loc-permissions/route.js'),/handleLocSelfPermissions/);
  assert.match(source('app/loc/server/public-named-transactions.mjs'),/handleNamedPublicTransaction/);
  assert.doesNotMatch(source('app/loc/server/public-named-transactions.mjs'),
    /req\.schema|req\.table|body\.columns|body\.filters|body\.sql/);
  assert.doesNotMatch(source('app/loc/auth/editor-grants.mjs'),/\/api\/loc-permissions|fetchImpl/);
  assert.doesNotMatch(source('app/loc/permissions/loc_access.mjs'),/selectFrom\('api\.manage'\)/);
  assert.doesNotMatch(source('app/loc/providers/loc-authorization.mjs'),/selectFrom\('api\.manage/);
});
}

{
const source=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('LOC MCP roles use published JS, even if a database cannot connect',async()=>{
  const forbidden={selectFrom(){throw Error('DB role SELECT forbidden');},
    transaction(){throw Error('DB role transaction forbidden');}};
  const rights=await loadMcpLocAccess(forbidden,'sopa2306@gmail.com');
  assert.equal(rights.canWrite,true);
  assert.equal(rights.canManage,false);
  assert.ok(rights.grants.includes('lo3rwang:write'));
  const identity=await authorizeMcpRole('sopa2306@gmail.com');
  assert.ok(identity.roles.some(x=>x.id==='lo3rwang'));
  await assert.rejects(authorizeMcpRole('unknown@example.org'),
    error=>error.httpStatus===403);
  await assert.rejects(authorizeMcpRole('not-an-email'),
    error=>error.httpStatus===401);
});

test('standalone MCP role and Scope status operations are retired',async()=>{
  let connected=0;
  for(const kind of ['mcp-authorize','mcp-scope-status']){
    const request=new Request('https://loc.lo3rwang.cc/api/las-native',{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({kind,scopeid:'lo3rwang'})
    });
    const response=await handleNativeLocOperation(request,{},{
      database:async()=>{connected++;throw Error('No SQL for retired operation');}
    });
    assert.equal(response.status,400,kind);
  }
  assert.equal(connected,0);
});

test('real business operations resolve JS rights before any DB connection',()=>{
  const roles=source('app/loc/mcp/access-roles.mjs');
  assert.doesNotMatch(roles,/directMcpKysely|closeLocDatabase|selectFrom/);
  const code=source('app/loc/mcp/native-operations.mjs');
  const rights=code.indexOf('const rights=host===MCP_HOST');
  const database=code.indexOf('selected=await database(');
  assert.ok(rights>0&&database>rights);
  assert.match(code,/await loadMcpLocAccess\(null,claims\.email\)/);
  assert.match(code,/await readLocAccess\(null,claims\.email,\{website:true\}\)/);
  assert.match(code,/await selected\.db\.transaction\(\)\.execute\(async trx=>/);
});
}

{
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('fixed JS Manage catalog has unique Scope identifiers',()=>{
  assert.equal(new Set(FIXED_MANAGE_ROWS.map(row=>row.id)).size,FIXED_MANAGE_ROWS.length);
  for(const row of FIXED_MANAGE_ROWS){
    assert.equal(row.galaxy_table,'galaxy');
    assert.equal(row.anchor_table,'anchor');
    assert.equal(fixedManageScope(row.id),row);
  }
  assert.equal(fixedManageScope('external'),null);
  assert.equal(fixedManageScope('__proto__'),null);
  assert.equal(fixedManageScope('admin').active,false);
});

test('built-in publication and JS Manage registry agree on routing and role',()=>{
  assert.equal(publishedManagedScope('admin'),null);
  for(const id of ['loc','lo3rwang','lrunes']){
    const row=publishedManagedScope(id);
    assert.equal(row.id,id);
    assert.equal(row.active,true);
    assert.equal(row, fixedManageScope(id));
  }
  assert.equal(publishedManagedScope('external'),null);
});

test('fixed registry removes SQL mapping probes but not signed authorization checks',()=>{
  const code=read('app/loc/providers/kysely-management.mjs');
  assert.match(code,/return publishedManagedScope\(scope\);/);
  assert.doesNotMatch(code,/selectFrom\('api\.manage'\)/);
  assert.match(code,/const record=await registeredScope\(trx,scope\);/);
  assert.match(code,/canLocAccess\(trx,'scope',scope\)/);
  const roles=read('app/loc/permissions/loc_access.mjs');
  assert.doesNotMatch(roles,/selectFrom\('api\.manage'\)/);
  assert.match(roles,/publishedLocAccess\(email,\{website\}\)/);
});

test('Manage changes cannot commit a role or route different from published JS',()=>{
  const native=read('app/loc/mcp/native-operations.mjs');
  assert.match(native,/requirePublishedManageWrite\(body\.payload\)/);
  assert.match(native,/for\(const item of body\.operations\)\{/);
  assert.match(native,/requirePublishedManageWrite\(item\)/);
  assert.match(native,/Object\.is\(fixed\[field\],value\)/);
  const lifecycle=read('app/loc/providers/kysely-scope-lifecycle.mjs');
  assert.match(lifecycle,/fixedManageScope\(id\)\?\.active===true/);
});

test('Statistics and public Search use published Scope JS, never api.manage SQL',()=>{
  const analytics=read('app/loc/providers/kysely-analytics.mjs');
  assert.doesNotMatch(analytics,/selectFrom\('api\.manage'\)|zmodelRegistryJoin/);
  assert.match(analytics,/publishedManagedScope\(scope\)/);
  assert.match(analytics,/FIXED_MANAGE_ROWS\.filter/);
});

test('Registry writes cannot silently outrun the published JS route',()=>{
  const lifecycle=read('app/loc/providers/kysely-scope-lifecycle.mjs');
  assert.match(lifecycle,/Publish matching JS Scope routing before Registry update/);
});
}

{
test('LOC sign-in redirects to LAS Google OAuth without Cloudflare SSO',async()=>{
  const original=globalThis.window;
  const redirects=[];
  globalThis.window={location:{assign(url){redirects.push(url);}}};
  try{
    const {auth}=createLocAccountAdapter();
    const signedIn=await auth.signInWithOAuth({
      provider:'google',options:{redirectTo:'/admin/'}
    });
    assert.equal(signedIn.error,null);
    assert.equal(redirects[0],'https://auth.lo3rwang.cc/login?return_to=%2Fadmin%2F');
    const rejected=await auth.signInWithOAuth({
      provider:'cloudflare',options:{redirectTo:'/admin/'}
    });
    assert.ok(rejected.error);
    assert.equal(redirects.length,1);
    const external=await auth.signInWithOAuth({
      provider:'google',options:{redirectTo:'https://invalid.example/admin/'}
    });
    assert.equal(external.error,null);
    assert.equal(redirects[1],
      'https://auth.lo3rwang.cc/login?return_to=%2Flocal%2Fsettings%2F');
  }finally{
    if(original===undefined)delete globalThis.window;
    else globalThis.window=original;
  }
});
}
