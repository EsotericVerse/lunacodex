import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadMcpLocAccess,authorizeMcpRole} from
  '../app/loc/mcp/access-roles.mjs';
import {handleNativeLocOperation} from
  '../app/loc/mcp/native-operations.mjs';

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
  const code=source('app/loc/mcp/native-operations.mjs');
  for(const forbidden of ['mcp-authorize','mcp-scope-status',
    "selectFrom('api.manage')"]){
    assert.equal(code.includes(forbidden),false,forbidden+' must not survive');
  }
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
