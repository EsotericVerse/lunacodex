import test from 'node:test';
import assert from 'node:assert/strict';
import {rememberBrowserPermissions,readBrowserPermissions,
  markBrowserPermissionUnavailable,clearBrowserPermissions}
  from '../app/loc/auth/browser-permission-session.mjs';

const storage=()=>{
  const values=new Map();
  return {
    getItem:key=>values.get(key)??null,
    setItem:(key,value)=>values.set(key,value),
    removeItem:key=>values.delete(key),
    values
  };
};

test('browser Session stores only scope/role projection for the verified identity',()=>{
  const s=storage();
  assert.equal(rememberBrowserPermissions(s,{id:'user-1'},[
    {scopeid:'loc',role:'group',email:'private@example.com'},
    {scopeid:'lo3rwang',role:'scope'},
    {scopeid:'bad scope',role:'admin'}
  ],1234),true);
  assert.deepEqual(readBrowserPermissions(s,'user-1'),{
    userId:'user-1',scopes:[
      {scopeId:'loc',role:'group'},
      {scopeId:'lo3rwang',role:'scope'}
    ],verifiedAt:1234,status:'verified'
  });
  assert.equal(readBrowserPermissions(s,'user-2'),null);
  const raw=[...s.values.values()].join(' ');
  assert.equal(raw.includes('private@example.com'),false);
  assert.equal(raw.includes('global:manage'),false);
});

test('temporary upstream failure is remembered without deleting the display snapshot',()=>{
  const s=storage();
  rememberBrowserPermissions(s,{id:'user-1'},[{scopeid:'loc',role:'group'}],1234);
  markBrowserPermissionUnavailable(s);
  assert.equal(readBrowserPermissions(s,'user-1')?.status,'unavailable');
  clearBrowserPermissions(s);
  assert.equal(readBrowserPermissions(s,'user-1'),null);
});

test('invalid stored permissions cannot be consumed as a valid snapshot',()=>{
  const s=storage();
  s.setItem('loc-browser-permissions-v1',JSON.stringify({
    userId:'user-1',scopes:[{scopeId:'bad scope',role:'admin'}],verifiedAt:123
  }));
  assert.equal(readBrowserPermissions(s,'user-1'),null);
});
