import test from 'node:test';
import assert from 'node:assert/strict';
import {handleLocSelfPermissions} from '../app/loc/permissions/loc-permissions-server.mjs';
import {LOC_OWNER_EMAIL} from '../app/loc/permissions/loc-business-grants.mjs';
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
import {handleNativeLocOperation,requireManagedActionGrant} from '../app/loc/mcp/native-operations.mjs';
import {FIXED_MANAGE_ROWS} from '../app/loc/permissions/fixed-manage-registry.mjs';
import {fixedManageScope} from '../app/loc/permissions/fixed-manage-registry.mjs';
import {publishedManagedScope} from '../app/loc/providers/published-managed-scope.mjs';
import {createLocAccountAdapter} from '../app/loc/auth/loc-browser.mjs';
import {withAuthorizedLocRead} from '../app/loc/actions/read-context.mjs';
import {withKeywordScope} from '../app/loc/actions/keywords/context.mjs';
import {executeManagedKyselyAction} from '../app/loc/providers/kysely-management.mjs';

{

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

test('feature Server Actions reject missing Scope grants before opening SQL',async()=>{
  let connected=0,read=0;
  const dependencies={
    getHeaders:async()=>new Headers({cookie:'loc_session=opaque'}),
    verifySession:async request=>{
      assert.equal(request.headers.get('cookie'),'loc_session=opaque');
      return {userId:'USER_NO_SCOPE',email:'ungranted@example.org'};
    },
    openDatabase:async()=>{connected++;throw Error('SQL must stay closed');},
    closeDatabase:async()=>{}
  };
  await assert.rejects(withAuthorizedLocRead({scope:'lo3rwang'},async()=>{
    read++;
  },dependencies),error=>error.httpStatus===403);
  assert.equal(connected,0);
  assert.equal(read,0);
});

test('Keyword read and write actions reject missing grants before opening SQL',async()=>{
  for(const write of [false,true]){
    let connected=0,ran=0;
    const dependencies={
      getHeaders:async()=>new Headers({cookie:'loc_session=opaque'}),
      verifySession:async()=>({userId:'USER_NO_SCOPE',email:'ungranted@example.org'}),
      openDatabase:async()=>{connected++;throw Error('SQL must stay closed');},
      closeDatabase:async()=>{}
    };
    await assert.rejects(withKeywordScope('lo3rwang',{write},async()=>{ran++;},dependencies),
      error=>error.httpStatus===403);
    assert.equal(connected,0);
    assert.equal(ran,0);
  }
});

test('feature Server Actions refuse an unscoped read before checking identity or opening SQL',async()=>{
  let verified=0,connected=0;
  await assert.rejects(withAuthorizedLocRead({},async()=>{}, {
    getHeaders:async()=>new Headers(),
    verifySession:async()=>{verified++;throw Error('Must reject before session');},
    openDatabase:async()=>{connected++;throw Error('Must reject before SQL');},
    closeDatabase:async()=>{}
  }),error=>error.httpStatus===400);
  assert.equal(verified,0);
  assert.equal(connected,0);
});

test('managed writes check the requested Scope grant before opening the database',()=>{
  const claims={provider:'loc',role:'authenticated',sub:'USER_SCOPE_ONLY',
    me:true,grants:['lrunes:manage','scope:lrunes:manage','lrunes:write','lrunes:read']};
  assert.doesNotThrow(()=>requireManagedActionGrant({name:'fill_galaxy_place',
    args:{p_scope_id:'lrunes'}},claims));
  assert.throws(()=>requireManagedActionGrant({name:'fill_galaxy_place',
    args:{p_scope_id:'lo3rwang'}},claims),error=>error.httpStatus===403);
});

test('authorized feature reads use one direct connection without a read transaction',async()=>{
  let connected=0,closed=0,read=0,transaction=0;
  const db={transaction(){transaction++;throw Error('Read transaction forbidden');}};
  const dependencies={
    getHeaders:async()=>new Headers({cookie:'loc_session=opaque'}),
    verifySession:async()=>({userId:'USER_OWNER',email:LOC_OWNER_EMAIL}),
    openDatabase:async()=>{connected++;return {db,engine:'postgres',namespace:'silver'};},
    closeDatabase:async()=>{closed++;}
  };
  const result=await withAuthorizedLocRead({scope:'lo3rwang'},async(_db,port,{grants})=>{
    read++;
    assert.equal(port.engine,'postgres');
    assert.ok(grants.includes('global:manage'));
    return 'feature-result';
  },dependencies);
  assert.equal(result,'feature-result');
  assert.equal(connected,1);
  assert.equal(read,1);
  assert.equal(transaction,0);
  assert.equal(closed,1);
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

test('retired generic public SQL HTTP routes and legacy read handlers remain absent',()=>{
  assert.equal(existsSync(new URL('../app/api/loc-public-query',import.meta.url)),false);
  for(const route of ['loc-query','loc-public-content','loc-public-classes',
    'loc-auth-connectivity'])
    assert.equal(existsSync(new URL('../app/api/'+route,import.meta.url)),false,route);
  assert.equal(existsSync(new URL('../app/api/keywords/route.js',import.meta.url)),false);
  assert.equal(existsSync(new URL('../app/loc/keywords/api.mjs',import.meta.url)),false);
  assert.doesNotMatch(read('app/loc/keywords/service-client.mjs'),/fetch\s*\(/);
  for(const file of ['app/loc/galaxy/feature-query-server.mjs',
    'app/loc/galaxy/records-query-server.mjs',
    'app/loc/anchor/feature-query-server.mjs',
    'app/loc/culture/time-anchor-query-server.mjs'])
    assert.equal(existsSync(new URL('../'+file,import.meta.url)),false,file);
});

test('Search bulk preview is feature-owned and its writer accepts no preview mode',()=>{
  const search=read('app/modular/features/Search.jsx');
  assert.match(search,/queryGalaxyLocationBatchPreview/);
  assert.match(search,/managedAction\('apply_galaxy_location_batch'/);
  assert.doesNotMatch(search,/batch_fill_galaxy_location|p_apply:/);
});

test('LOC native HTTP channel rejects reads before opening SQL',async()=>{
  let connected=0;
  const requests=[
    {kind:'mcp-read',scopeid:'lo3rwang',uid:'ABCD1234'},
    {kind:'mcp-search',scopeid:'lo3rwang',query:'private',limit:5},
    {kind:'mcp-public-read',scopeid:'lo3rwang',args:{uid:'ABCD1234'}},
    {kind:'mcp-article-stat',scopeid:'loc'},
    {kind:'mcp-conversation',scopeid:'lo3rwang',action:'check'},
    {kind:'mcp-conversation',scopeid:'lo3rwang',action:'search'},
    {kind:'managed-action',scopeid:'lo3rwang',name:'search_galaxy_private',
      args:{p_scope_id:'lo3rwang',p_query:'private'}},
    {kind:'managed-action',scopeid:'lo3rwang',name:'anchor_import_page',
      args:{p_scope_id:'lo3rwang',p_types:['point'],p_limit:10}},
    {kind:'managed-action',scopeid:'loc',name:'loc_admin_settings',
      args:{p_operation:'read',p_section:'theme'}},
    {kind:'managed-action',scopeid:'lo3rwang',name:'preview_galaxy_place_fill',
      args:{p_scope_id:'lo3rwang',p_start_date:'2026-01-01',p_end_date:'2026-01-02',p_place:'Tainan'}},
    {kind:'managed-action',scopeid:'lo3rwang',name:'fill_galaxy_place',
      args:{p_scope_id:'lo3rwang',p_start_date:'2026-01-01',p_end_date:'2026-01-02',
        p_place:'Tainan',p_expected_count:1,p_apply:false}},
    {kind:'managed-action',scopeid:'lo3rwang',name:'bulk_update_galaxy_able',
      args:{p_scope_id:'lo3rwang',p_site:'facebook',p_flags:{statics:false},p_apply:false}}
  ];
  for(const body of requests){
    const request=new Request('https://mcp.lo3rwang.cc/api/las-native',{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify(body)
    });
    const response=await handleNativeLocOperation(request,{}, {
      database:async()=>{connected++;throw Error('A read reached SQL');}
    });
    assert.notEqual(response.status,200,body.kind);
  }
  assert.equal(connected,0);
});

test('write dispatcher has no generic read action, including settings reads',async()=>{
  let queried=0;
  const db={selectFrom(){queried++;throw Error('Managed write channel must not read');}};
  for(const [name,args] of [
    ['read_group_members',{p_group_id:'loc'}],
    ['read_loc_source_hierarchy',{}],
    ['read_scope_registry_admin',{}],
    ['find_galaxy_duplicates',{p_scope_id:'loc'}],
    ['search_galaxy_private',{p_scope_id:'loc',p_query:'secret'}],
    ['loc_admin_settings',{p_operation:'read',p_section:'theme'}],
    ['preview_galaxy_place_fill',{p_scope_id:'loc'}],
    ['fill_galaxy_place',{p_scope_id:'loc',p_apply:false}],
    ['bulk_update_galaxy_able',{p_scope_id:'loc',p_apply:false}]
  ]){
    await assert.rejects(executeManagedKyselyAction(db,{name,args}),
      /Unknown Kysely action|LOC settings read actions are closed/);
  }
  assert.equal(queried,0);
});

test('temporary bulk-write route is closed by default and still authenticates when enabled',async()=>{
  let connected=0;
  const ordinary={kind:'managed-action',scopeid:'lo3rwang',
    name:'fill_galaxy_place',args:{p_scope_id:'lo3rwang',
      p_start_date:'2026-01-01',p_end_date:'2026-01-02',
      p_place:'Tainan',p_expected_count:1}};
  const ordinaryResponse=await handleNativeLocOperation(
    new Request('https://loc.lo3rwang.cc/api/loc-native',{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify(ordinary)
    }),{}, {database:async()=>{connected++;throw Error('HTTP save must stay closed');}});
  assert.equal(ordinaryResponse.status,404);
  const body={kind:'short-import',scopeid:'lo3rwang',batch:{}};
  const makeRequest=()=>new Request('https://loc.lo3rwang.cc/api/loc-native',{
    method:'POST',headers:{'content-type':'application/json','cookie':'loc_session=present'},
    body:JSON.stringify(body)
  });
  const database=async()=>{connected++;throw Error('Permission gate must run before SQL');};
  const closed=await handleNativeLocOperation(makeRequest(),{}, {database});
  assert.equal(closed.status,404);
  const opened=await handleNativeLocOperation(makeRequest(),
    {LOC_BULK_IMPORT_ENABLED:'true'}, {
      database,fetchImpl:async()=>new Response(JSON.stringify({
        session:{id:'session'},user:{id:'unknown-user',email:'unknown@example.org',emailVerified:true}
      }),{status:200,headers:{'content-type':'application/json'}})
    });
  assert.equal(opened.status,403);
  assert.equal(connected,0);

  // The same bulk flag controls the dedicated LAS bridge, including calls
  // made through its trusted host mapping. Enabling it still requires OAuth.
  const mcpRequest=()=>new Request('https://loc.lo3rwang.cc/api/las-native',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify(body)
  });
  const mcpClosed=await handleNativeLocOperation(mcpRequest(),{},
    {database,trustedMcpBridge:true});
  assert.equal(mcpClosed.status,404);
  const mcpEnabled=await handleNativeLocOperation(mcpRequest(),
    {LOC_BULK_IMPORT_ENABLED:'true'}, {database,trustedMcpBridge:true});
  assert.equal(mcpEnabled.status,401);
  const localClosed=await handleNativeLocOperation(makeRequest(),{},
    {trustedLocalAction:true,database});
  assert.equal(localClosed.status,404);

  // LAS exposes only its named write operations; it does not expose LOC's
  // generic managed-action/transaction dispatch over HTTP.
  for(const generic of [
    {kind:'managed-write',scopeid:'',payload:{p_operation:'insert',p_table:'silver.loc_blocks'}},
    {kind:'managed-transaction',scopeid:'',operations:[{p_operation:'delete',p_table:'silver.loc_blocks'}]},
    {kind:'managed-action',scopeid:'lo3rwang',name:'save_blocks',
      args:{p_scope_id:'lo3rwang',p_type:'search',p_blocks:[]}}
  ]){
    const response=await handleNativeLocOperation(new Request(
      'https://loc.lo3rwang.cc/api/las-native',{
        method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify(generic)
      }),{}, {database,trustedMcpBridge:true});
    assert.equal(response.status,404,generic.kind);
  }
  assert.equal(connected,0);
});
}

{

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

}

{
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('browser database adapter cannot execute generic SELECT or publicAction calls',()=>{
  const client=read('app/loc/providers/kysely-browser.mjs');
  assert.match(client,/LOC database reads must use their feature query action/);
  assert.doesNotMatch(client,/publicAction/);
  assert.doesNotMatch(client,/analytics/);
});

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

test('Manage changes cannot commit a role or route different from published JS',()=>{
  const native=read('app/loc/mcp/native-operations.mjs');
  assert.match(native,/requirePublishedManageWrite\(body\.payload\)/);
  assert.match(native,/for\(const item of body\.operations\)\{/);
  assert.match(native,/requirePublishedManageWrite\(item\)/);
  assert.match(native,/Object\.is\(fixed\[field\],value\)/);
  const lifecycle=read('app/loc/providers/kysely-scope-lifecycle.mjs');
  assert.match(lifecycle,/fixedManageScope\(id\)\?\.active===true/);
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

{
const origin='https://loc.lo3rwang.cc';
const req=(body,path)=>new Request(origin+path,{
  method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
test('permissions return only Session self-projection without SQL',async()=>{
  const response=await handleLocSelfPermissions(req({operation:'self'},
    '/api/loc-permissions'),{verifySession:async()=>({email:LOC_OWNER_EMAIL})});
  assert.equal(response.status,200);
  const payload=await response.json();
  assert.ok(payload.grants.includes('global:manage'));
  assert.equal(payload.canManage,true);
  assert.equal(payload.connectionString,undefined);
  const cross=new Request(origin+'/api/loc-permissions',{method:'POST',
    headers:{origin:'https://evil.example'},body:'{"operation":"self"}'});
  const blocked=await handleLocSelfPermissions(cross,{
    verifySession:async()=>({email:LOC_OWNER_EMAIL})});
  assert.equal(blocked.status,403);
});
}
