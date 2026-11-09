import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readLocEditorGrants} from '../app/loc/auth/editor-grants.mjs';

const user={id:'loc_'+('A'.repeat(40)),email:'SOPA2306@GMAIL.COM'};
const session={user,oauth:{email:user.email},session:{access_token:'signed.loc.token'}};
const reply=grants=>Response.json({audience:'loc-delegation',grants});
test('clicked editor authorization calls native LOC Auth exactly once, no manage SQL lookup',async()=>{
  const calls=[];
  const result=await readLocEditorGrants(session,{
    scopeKinds:{loc:'group',lo3rwang:'scope'},
    fetchImpl:async(url,init)=>{calls.push({url,init});return reply(['loc:manage','lo3rwang:manage']);}
  });
  assert.deepEqual(result,[
    {id:'loc',email:'sopa2306@gmail.com',role:'group',manage_role:'group'},
    {id:'lo3rwang',email:'sopa2306@gmail.com',role:'scope',manage_role:'scope'}
  ]);
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'https://auth.lo3rwang.cc/v1/delegation');
  assert.equal(calls[0].init.method,'POST');
  assert.equal(calls[0].init.headers.authorization,'Bearer signed.loc.token');
  assert.deepEqual(JSON.parse(calls[0].init.body),{audience:'sql',self:true});
  assert.equal(calls[0].init.credentials,'omit');
});

test('native LOC Auth root delegation creates admin role without management SQL',async()=>{
  const result=await readLocEditorGrants(session,{fetchImpl:async()=>reply([
    'global:manage','global:manage','lrunes:manage'
  ])});
  assert.deepEqual(result.map(x=>[x.id,x.role]),[['admin','admin'],['lrunes','scope']]);
});
test('other OAuth users receive no write permission even with old management grants',async()=>{
  let calls=0;
  const stranger={...session,user:{...user,email:'reader@example.org'}};
  const rows=await readLocEditorGrants(stranger,{
    fetchImpl:async()=>{calls++;return reply(['global:manage']);}
  });
  assert.deepEqual(rows,[]);
  assert.equal(calls,0);
});
test('anonymous click never contacts management SQL or LOC Authority delegation',async()=>{
  let calls=0;
  await assert.rejects(readLocEditorGrants(null,{fetchImpl:async()=>{calls++;return reply([])}}),
    /verified session required/);
  assert.equal(calls,0);
});
test('denied or malformed Authority grants do not enter edit mode',async()=>{
  await assert.rejects(readLocEditorGrants(session,{
    fetchImpl:async()=>Response.json({error:'denied'},{status:403})
  }),/HTTP 403/);
  for(const grants of [
    ['global:manage','api.manage'],
    ['user:read'],
    ['administrator'],
    null
  ])await assert.rejects(readLocEditorGrants(session,{
    fetchImpl:async()=>Response.json({audience:'loc-delegation',grants})
  }),/回應不完整/);
  assert.deepEqual(await readLocEditorGrants(session,{fetchImpl:async()=>reply([])}),[]);
});
test('homepage edit click uses LOC Auth; passive rendering never calls manage(self)',()=>{
  const account=readFileSync(new URL('../app/loc/use-account.js',import.meta.url),'utf8');
  const button=readFileSync(new URL('../app/loc/ScopeHomeEditEntry.jsx',import.meta.url),'utf8');
  const dataApi=readFileSync(new URL('../app/loc/providers/direct-data-api.mjs',import.meta.url),'utf8');
  assert.match(account,/readLocEditorGrants\(session/);
  assert.doesNotMatch(account,/managedAction\(['"]manage['"]/);
  assert.match(button,/onClick=\{enter\}/);
  assert.match(button,/const result=await account\.refresh\(\)/);
  assert.match(button,/useAccount\(\{enabled:false\}\)/);
  assert.match(dataApi,/managedAction:unsupported/);
});
