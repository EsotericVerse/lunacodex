import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rememberCurrentBrowserRoute,resolveScope}
  from '../app/modular/routing/scope-registry.js';
import {editorSessionStatus,touchEditorSession,EDIT_IDLE_TTL_MS,
  EDIT_SESSION_TTL_MS} from '../app/loc/auth/edit-session-ttl.mjs';

const memory=()=>{
  const m=new Map(),writes=[];
  return {
    writes,values:m,
    getItem:key=>m.get(key)??null,
    setItem:(key,value)=>{m.set(key,value);writes.push([key,value])},
    removeItem:key=>m.delete(key)
  };
};

test('current browser Scope and page directory are stored only on change',()=>{
  const s=memory();
  assert.deepEqual(rememberCurrentBrowserRoute(s,'lo3rwang','/lo3rwang/culture/manage/'),{
    scopeId:'lo3rwang',pathname:'/lo3rwang/culture/manage',
    directory:'/lo3rwang/culture/manage/'
  });
  assert.deepEqual([...s.values.keys()],[
    'current_scopeid','current_pathname','current_directory'
  ]);
  assert.equal(s.writes.length,3);
  rememberCurrentBrowserRoute(s,'lo3rwang','/lo3rwang/culture/manage');
  assert.equal(s.writes.length,3,'same route must not rewrite Session state');
  rememberCurrentBrowserRoute(s,'lo3rwang','/lo3rwang/trace/');
  assert.equal(s.values.get('current_scopeid'),'lo3rwang');
  assert.equal(s.values.get('current_directory'),'/lo3rwang/trace/');
  assert.equal(s.writes.length,5);
});

test('route changes derive Scope from URL, never stale sessionStorage',()=>{
  const s=memory();
  s.setItem('current_scopeid','lo3rwang');
  const fromRoute=resolveScope('loc.lo3rwang.cc','/admin/');
  assert.equal(fromRoute,'loc');
  rememberCurrentBrowserRoute(s,fromRoute,'/admin/');
  assert.equal(s.getItem('current_scopeid'),'loc');
  assert.equal(s.getItem('current_directory'),'/admin/');
});

test('native bundled index.html remembers its containing directory',()=>{
  const s=memory();
  const route=rememberCurrentBrowserRoute(s,'lrunes','/lrunes/culture/index.html');
  assert.equal(route.pathname,'/lrunes/culture/index.html');
  assert.equal(route.directory,'/lrunes/culture/');
  assert.equal(rememberCurrentBrowserRoute(s,'invalid scope','/'),null);
});

test('invalid routes and disabled storage do not affect navigation',()=>{
  const s=memory();
  assert.equal(rememberCurrentBrowserRoute(s,'invalid scope','/culture/'),null);
  assert.equal(rememberCurrentBrowserRoute(s,'loc','not-a-route'),null);
  assert.equal(s.writes.length,0);
  const noStorage={getItem(){throw Error('blocked')},setItem(){throw Error('blocked')}};
  assert.deepEqual(rememberCurrentBrowserRoute(noStorage,'loc','/'),{
    scopeId:'loc',pathname:'/',directory:'/'
  });
});

test('route snapshots never create/reset a second edit Session clock',()=>{
  const s=memory(),start=1700000000000;
  assert.equal(touchEditorSession(s,start),true);
  const initial=editorSessionStatus(s,start);
  rememberCurrentBrowserRoute(s,'lo3rwang','/lo3rwang/culture/');
  rememberCurrentBrowserRoute(s,'lo3rwang','/lo3rwang/trace/');
  const after=editorSessionStatus(s,start+60_000);
  assert.equal(after.startedAt,initial.startedAt);
  assert.equal(after.lastActivityAt,initial.lastActivityAt);
  assert.equal(after.expired,false);
  assert.equal(editorSessionStatus(s,start+EDIT_IDLE_TTL_MS).expired,true);
  assert.equal(editorSessionStatus(s,start+EDIT_SESSION_TTL_MS).expired,true);
});
