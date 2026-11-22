import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {recoverChunkOnce,isChunkLoadFailure}
  from '../app/loc/ui/chunk-recovery.mjs';

const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
function browserStub({editing=false,query='',confirm=true,storageFails=false}={}){
  let reloads=0,prompts=0;
  const storage=new Map();
  const browser={
    location:{protocol:'https:',pathname:'/lo3rwang/search',search:query,
      reload(){reloads++}},
    document:{documentElement:{dataset:editing?{locEditing:'true'}:{}}},
    sessionStorage:{
      getItem(key){if(storageFails)throw Error('Storage blocked');return storage.get(key)||null},
      setItem(key,value){if(storageFails)throw Error('Storage blocked');storage.set(key,value)}
    },
    confirm(){prompts++;return confirm}
  };
  return {browser,storage,stats:()=>({reloads,prompts})};
}
const chunk=()=>new Error('Failed to fetch dynamically imported module');

test('ordinary render, SQL and RPC errors never trigger automatic reload',()=>{
  for(const message of ['HTTP 503','RPC unavailable','Component threw']){
    const error=new Error(message);
    assert.equal(isChunkLoadFailure(error),false);
    const {browser,stats}=browserStub();
    assert.throws(()=>recoverChunkOnce(error,{browser,now:1000000}),e=>e===error);
    assert.deepEqual(stats(),{reloads:0,prompts:0});
  }
});

test('stale chunk reloads at most once in a two-minute window outside editing',()=>{
  const {browser,stats}=browserStub();
  const first=chunk();
  assert.equal(isChunkLoadFailure(first),true);
  // The helper deliberately returns a never-settling Promise after reload.
  assert.equal(typeof recoverChunkOnce(first,{browser,now:1000000}).then,'function');
  assert.deepEqual(stats(),{reloads:1,prompts:0});
  const second=chunk();
  assert.throws(()=>recoverChunkOnce(second,{browser,now:1000001}),e=>e===second);
  assert.deepEqual(stats(),{reloads:1,prompts:0});
});

test('editing without edit=1 prompts before any stale-chunk reload',()=>{
  const {browser,stats}=browserStub({editing:true,confirm:false});
  const failure=chunk();
  assert.throws(()=>recoverChunkOnce(failure,{browser,now:1000000}),e=>e===failure);
  assert.deepEqual(stats(),{reloads:0,prompts:1});
  // Denial must not consume the one-time recovery allowance.
  browser.confirm=()=>true;
  recoverChunkOnce(chunk(),{browser,now:1000001});
  assert.equal(stats().reloads,1);
});

test('legacy ?edit=1 still prompts, even without an active EditDock marker',()=>{
  const {browser,stats}=browserStub({query:'?edit=1',confirm:false});
  assert.throws(()=>recoverChunkOnce(chunk(),{browser,now:1000000}));
  assert.deepEqual(stats(),{reloads:0,prompts:1});
});

test('unavailable sessionStorage fails closed without a reload',()=>{
  const {browser,stats}=browserStub({storageFails:true});
  assert.throws(()=>recoverChunkOnce(chunk(),{browser,now:1000000}));
  assert.deepEqual(stats(),{reloads:0,prompts:0});
});

test('the edit marker is ephemeral and maintained by EditDock transitions',()=>{
  const dock=source('app/modular/edit-dock.jsx');
  assert.match(dock,/root\.dataset\.locEditing='true'/);
  assert.match(dock,/delete root\.dataset\.locEditing/);
  assert.match(dock,/const end=useCallback\(\(\)=>\{\s*markEditorActive\(false\)/);
  assert.match(dock,/markEditorActive\(true\);\s*setEditing\(true\)/);
  assert.match(dock,/function logCleanupFailure\(failure\)/);
  assert.doesNotMatch(dock,/console\.error\('\[LOC edit-dock\] onFailure cleanup failed',cleanup\)/);
});

test('route and root error boundaries are independent and retry render only',()=>{
  const route=source('app/error.jsx');
  const global=source('app/global-error.jsx');
  assert.match(route,/^'use client';/);
  assert.match(global,/^'use client';/);
  assert.match(route,/recoverChunkOnce\(error\)/);
  assert.match(route,/onClick=\{\(\)=>reset\(\)\}/);
  assert.match(global,/<html lang="zh-Hant">/);
  assert.match(global,/<body style=/);
  assert.match(global,/onClick=\{\(\)=>reset\(\)\}/);
  assert.doesNotMatch(global,/^import .*?(?:AppShell|globals\.css|db-client|chunk-recovery)/m);
  assert.doesNotMatch(route,/console\.error\('\[LOC route error\]',error\)/);
  assert.doesNotMatch(global,/console\.error\('\[LOC global error\]',error\)/);
});
