import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {LOC_SERVICE_ORIGINS,locServiceHref} from '../app/modular/routing/service-route-index.mjs';

test('LOC outbound targets remain separate from public Scope URLs',()=>{
  assert.equal(locServiceHref('lrs','/game/'),'https://lrs.lo3rwang.cc/game/');
  assert.equal(locServiceHref('lrs','/card/duel/'),'https://lrs.lo3rwang.cc/card/duel/');
  assert.equal(locServiceHref('lrs','/daily/'),'https://lrs.lo3rwang.cc/daily/');
  assert.equal(locServiceHref('auth','/login'),'https://auth.lo3rwang.cc/login');
  assert.equal(locServiceHref('mcp','/'),'https://mcp.lo3rwang.cc/');
  assert.equal(new Set(Object.values(LOC_SERVICE_ORIGINS)).size,3);
  for(const name of ['auth','mcp','lrs'])
    assert.notEqual(LOC_SERVICE_ORIGINS[name],'https://loc.lo3rwang.cc');
  const scopeIndex=readFileSync(new URL('../app/modular/routing/scope-route-index.js',import.meta.url),'utf8');
  assert.doesNotMatch(scopeIndex,/'scope_id":"(?:auth|mcp|lrs)"/);
});

test('external paths cannot hijack another origin',()=>{
  for(const path of ['https://invalid.example/','//invalid.example/','\\\\invalid.example','game'])
    assert.throws(()=>locServiceHref('lrs',path));
  assert.throws(()=>locServiceHref('unknown','/'));
});
