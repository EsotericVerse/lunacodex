import test from 'node:test';
import assert from 'node:assert/strict';
import {recoverChunkOnce,isChunkLoadFailure}
  from '../app/loc/ui/chunk-recovery.mjs';

function browserStub({editing=false,query='',confirm=true,navigationType='navigate',navigationAvailable=true}={}){
  let reloads=0,prompts=0;
  const browser={
    location:{protocol:'https:',pathname:'/lo3rwang/search',search:query,
      reload(){reloads++}},
    document:{documentElement:{dataset:editing?{locEditing:'true'}:{}}},
    performance:{getEntriesByType(type){
      assert.equal(type,'navigation');
      return navigationAvailable?[{type:navigationType}]:[];
    }},
    confirm(){prompts++;return confirm}
  };
  return {browser,stats:()=>({reloads,prompts})};
}
const chunk=()=>new Error('Failed to fetch dynamically imported module');
test('ordinary render, SQL and RPC errors never trigger automatic reload',()=>{
  for(const message of ['HTTP 503','RPC unavailable','Component threw']){
    const error=new Error(message);
    assert.equal(isChunkLoadFailure(error),false);
    const {browser,stats}=browserStub();
    assert.throws(()=>recoverChunkOnce(error,{browser}),e=>e===error);
    assert.deepEqual(stats(),{reloads:0,prompts:0});
  }
});
test('stale chunk reloads a navigation but never loops after reload',()=>{
  const {browser,stats}=browserStub();
  const first=chunk();
  assert.equal(isChunkLoadFailure(first),true);
  assert.equal(typeof recoverChunkOnce(first,{browser}).then,'function');
  assert.deepEqual(stats(),{reloads:1,prompts:0});
  const after=browserStub({navigationType:'reload'});
  const second=chunk();
  assert.throws(()=>recoverChunkOnce(second,{browser:after.browser}),e=>e===second);
  assert.deepEqual(after.stats(),{reloads:0,prompts:0});
});
test('editing without edit=1 prompts before any stale-chunk reload',()=>{
  const {browser,stats}=browserStub({editing:true,confirm:false});
  const failure=chunk();
  assert.throws(()=>recoverChunkOnce(failure,{browser}),e=>e===failure);
  assert.deepEqual(stats(),{reloads:0,prompts:1});
  browser.confirm=()=>true;
  recoverChunkOnce(chunk(),{browser});
  assert.equal(stats().reloads,1);
});
test('legacy ?edit=1 still prompts, even without an active EditDock marker',()=>{
  const {browser,stats}=browserStub({query:'?edit=1',confirm:false});
  assert.throws(()=>recoverChunkOnce(chunk(),{browser}));
  assert.deepEqual(stats(),{reloads:0,prompts:1});
});
test('unavailable navigation information fails closed without a reload',()=>{
  const {browser,stats}=browserStub({navigationAvailable:false});
  assert.throws(()=>recoverChunkOnce(chunk(),{browser}));
  assert.deepEqual(stats(),{reloads:0,prompts:0});
});
