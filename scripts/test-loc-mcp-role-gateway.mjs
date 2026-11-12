import test from 'node:test';
import {readFileSync} from 'node:fs';
import {authorizeDelegatedShortImport} from '../app/loc/import/short-edge-authorization.mjs';
import assert from 'node:assert/strict';
import {eligibleMcpRoles,authorizeMcpRole,authorizeMcpBearer,
  locMcpPermissionsForEmail}
  from '../app/loc/mcp/access-roles.mjs';

function fixture(rows,events=[]){
  const builder={
    select(fields){events.push(['select',fields]);return builder;},
    where(column,op,value){events.push(['where',column,op,value]);return builder;},
    async execute(){return rows;}
  };
  return async()=>({db:{
    fn:(name,args)=>{events.push(['fn',name,args]);return 'lower(email)';},
    selectFrom:table=>{events.push(['table',table]);return builder;}
  }});
}
const email='scope@example.org';
const row=(role='scope',extra={})=>({
  id:'sample',email,manage_role:role,active:true,...extra
});

test('MCP permits existing active Scope, Group, Admin roles, but not an application',()=>{
  for(const role of ['scope','group','admin']){
    assert.deepEqual(eligibleMcpRoles(email,[row(role)]),[{id:'sample',role}]);
  }
  assert.deepEqual(eligibleMcpRoles(email,[row('user')]),[]);
  assert.deepEqual(eligibleMcpRoles(email,[row('scope',{active:false})]),[]);
  assert.deepEqual(eligibleMcpRoles(email,[row('scope',{email:'other@example.org'})]),[]);
  assert.deepEqual(eligibleMcpRoles(email,[row('scope',{id:''})]),[]);
});

test('MCP role query uses api.manage, current verified email, active rows',async()=>{
  const events=[];
  const result=await authorizeMcpRole('SCOPE@example.org',{},{
    database:fixture([row('group')],events)
  });
  assert.equal(result.email,email);
  assert.deepEqual(result.roles,[{id:'sample',role:'group'}]);
  assert.deepEqual(events[0],['table','api.manage']);
  assert.ok(events.some(event=>event[0]==='where'&&event[2]==='='&&event[3]===email));
  assert.ok(events.some(event=>event[0]==='where'&&event[1]==='active'&&event[3]===true));
});

test('MCP denies inactive or unrelated roles and never uses a fixed owner email',async()=>{
  for(const rows of [[],[row('scope',{active:false})],[row('scope',{email:'other@example.org'})]]){
    await assert.rejects(authorizeMcpRole(email,{},{
      database:fixture(rows)
    }),error=>error.httpStatus===403);
  }
  const other='another@example.org';
  const result=await authorizeMcpRole(other,{},{
    database:fixture([{...row('scope'),email:other}])
  });
  assert.equal(result.roles[0].role,'scope');
});

test('MCP rejects a failed SQL lookup without granting the role',async()=>{
  await assert.rejects(authorizeMcpRole(email,{},{
    database:async()=>{throw Error('Connection offline');}
  }),error=>error.httpStatus===503);
});

test('MCP bearer binds UserInfo subject to OAuth subject and verifies email',async()=>{
  const requests=[];
  const fetchImpl=async (url,options)=>{
    requests.push({url,auth:options.headers.authorization});
    return {ok:true,json:async()=>({
      sub:'loc_user_123',email_verified:true,email
    })};
  };
  const result=await authorizeMcpBearer('secret-token','loc_user_123',{},{
    fetchImpl,database:fixture([row('scope')])
  });
  assert.deepEqual(result.roles,[{id:'sample',role:'scope'}]);
  assert.equal(requests.length,1);
  assert.match(requests[0].url,/oauth2\/userinfo$/);
  assert.equal(requests[0].auth,'Bearer secret-token');
});

test('MCP bearer denies mismatched subjects or unverified email',async()=>{
  for(const profile of [
    {sub:'another-user',email_verified:true,email},
    {sub:'loc_user_123',email_verified:false,email},
    {sub:'loc_user_123',email_verified:true,email:''}
  ]){
    await assert.rejects(authorizeMcpBearer('token','loc_user_123',{},{
      fetchImpl:async()=>({ok:true,json:async()=>profile}),
      database:fixture([row()])
    }),error=>[401,403].includes(error.httpStatus));
  }
});

test('MCP does not allow access if userinfo is unavailable',async()=>{
  await assert.rejects(authorizeMcpBearer('token','loc_user_123',{},{
    fetchImpl:async()=>{throw Error('network down');},
    database:fixture([row()])
  }),error=>error.httpStatus===503);
});

test('Extension short-import accepts exactly the assigned api.manage Scope grant',async()=>{
  const db=(await fixture([row('scope')])()).db;
  const permission=await locMcpPermissionsForEmail(db,email);
  assert.deepEqual(permission.grants.sort(),
    ['sample:manage','sample:read','sample:write'].sort());
  assert.equal(permission.canManage,false,'Scope role is not global Admin');
  const claims={provider:'loc',me:permission.canWrite,
    sub:'loc_verified_subject',email,grants:permission.grants};
  const body={kind:'short-import',scopeid:'sample',batch:{id:'batch-test'}};
  assert.equal(authorizeDelegatedShortImport(body,claims).scopeid,'sample');
  assert.throws(()=>authorizeDelegatedShortImport({...body,scopeid:'another'},claims),
    /Scope write delegation required/);
});

test('Extension group roles are not promoted to global Admin or unrelated Scope',async()=>{
  const db=(await fixture([row('group')])()).db;
  const permission=await locMcpPermissionsForEmail(db,email);
  assert.equal(permission.canManage,false);
  assert.ok(!permission.grants.includes('global:manage'));
  assert.ok(permission.grants.includes('sample:write'));
  assert.ok(!permission.grants.includes('unrelated:write'));
});

test('Extension role revocation fails closed before any short-import write',async()=>{
  for(const roles of [[],[row('scope',{active:false})],
    [row('scope',{email:'unrelated@example.org'})]]){
    const db=(await fixture(roles)()).db;
    await assert.rejects(locMcpPermissionsForEmail(db,email),
      error=>error.httpStatus===403);
  }
});

test('Extension keeps its existing LOC Auth PKCE and Queue; backend shares MCP role gate',()=>{
  const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
  const bg=read('extensions/loc-galaxy-link/background.js');
  const cfg=JSON.parse(read('public/extension/oauth/config.json'));
  const native=read('app/loc/mcp/native-operations.mjs');
  const privateLink=read('app/loc/mcp/private-galaxy.mjs');
  const router=read('app/loc/mcp/router.mjs');
  assert.equal(cfg.issuer,'https://auth.lo3rwang.cc/api/auth');
  assert.equal(cfg.import_url,'https://mcp.lo3rwang.cc/api/loc-native');
  assert.match(bg,/chrome\.identity\.launchWebAuthFlow/);
  assert.match(bg,/const DB_NAME='loc-channel1-queue'/);
  assert.match(native,/host===MCP_HOST[\s\S]*?locMcpPermissionsForEmail\(selected\.db,claims\.email\)/);
  assert.match(privateLink,/locMcpPermissionsForEmail\(db,email\)/);
  assert.match(router,/authorizeMcpBearer\(match\[1\],identity\.subject,env\)/);
});
