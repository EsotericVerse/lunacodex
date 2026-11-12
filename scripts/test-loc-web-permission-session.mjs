import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolveLocPermissions} from '../app/loc/permissions/roles.mjs';
import {enableWebPermissionSession,readWebPermissionSession,clearWebPermissionSession,
  WEB_PERMISSION_IDLE_MS,WEB_PERMISSION_SESSION_MS} from '../app/loc/permissions/web-session.mjs';

const storage=()=>{
  const records=new Map();
  return {getItem:k=>records.get(k)||null,setItem:(k,v)=>records.set(k,v),removeItem:k=>records.delete(k)};
};
const person={id:'verified-web-user',email:'owner@example.com'};
const roles=[{id:'lrunes',email:person.email,role:'scope'}];

test('Web permission session is enabled only after valid role verification',()=>{
  const s=storage();
  assert.equal(readWebPermissionSession(s,person,1000),null);
  assert.equal(enableWebPermissionSession(s,person,roles,1000),true);
  assert.deepEqual(readWebPermissionSession(s,person,1100),[
    {...roles[0],manage_role:'scope'}
  ]);
  assert.equal(readWebPermissionSession(s,{...person,id:'other'},1200),null);
});
test('Web permission session expires on idle, absolute limit, or explicit clear',()=>{
  const s=storage();
  assert.equal(enableWebPermissionSession(s,person,roles,1000),true);
  assert.equal(readWebPermissionSession(s,person,1000+WEB_PERMISSION_IDLE_MS),null);
  assert.equal(enableWebPermissionSession(s,person,roles,1000),true);
  assert.ok(readWebPermissionSession(s,person,1000+WEB_PERMISSION_IDLE_MS-1));
  assert.equal(readWebPermissionSession(s,person,1000+WEB_PERMISSION_SESSION_MS),null);
  assert.equal(enableWebPermissionSession(s,person,roles,1000),true);
  clearWebPermissionSession(s);
  assert.equal(readWebPermissionSession(s,person,1001),null);
});
test('invalid roles cannot be promoted to a Web permission session',()=>{
  const s=storage();
  assert.equal(enableWebPermissionSession(s,person,[{...roles[0],role:'admin',email:'other@example.com'}]),false);
  assert.equal(enableWebPermissionSession(s,person,[{...roles[0],id:'../admin'}]),false);
  assert.equal(readWebPermissionSession(s,person),null);
});
test('Zod rejects invalid business role rows, while original role rules stay intact',()=>{
  const owner='sopa2306@gmail.com';
  const rows=[
    {id:'lrunes',email:owner,manage_role:'scope',active:true},
    {id:'bad id',email:owner,manage_role:'admin',active:true},
    {id:'loc',email:owner,manage_role:'superadmin',active:true}
  ];
  const grants=resolveLocPermissions(owner,rows);
  assert.equal(grants.canWrite,true);
  assert.equal(grants.canManage,false);
  assert.deepEqual(grants.roles.map(x=>x.id),['lrunes']);
});
test('the Web endpoint uses existing ZenStack PolicyPlugin, without modifying LOC Auth',()=>{
  const get=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
  const endpoint=get('functions/api/loc-permissions.js');
  const roles=get('app/loc/permissions/roles.mjs');
  const account=get('app/loc/use-account.js');
  assert.match(endpoint,/createFixedLocClient/);
  assert.match(endpoint,/PolicyPlugin/);
  assert.match(roles,/WebManageRowSchema\.safeParse/);
  assert.match(account,/readWebPermissionSession/);
  assert.match(account,/enableWebPermissionSession/);
});
