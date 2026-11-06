import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import vm from 'node:vm';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const source=read('app/modular/scope-registry.js');
const indexSource=read('app/modular/scope-route-index.js');
const corsSource=read('app/api/loc/_cors.js');

const stubUi={
  features:{
    statics:{title:'Statistics'},culture:{title:'Culture'},
    trace:{title:'Trace'},search:{title:'Search'}
  },
  scope:{loc:{statics:'',culture:'',trace:'',search:''},author:{search:''}},
  nav:{home:'Home',lunarunes:'Runes',author:'Author'}
};

async function load(sourceText,entry){
  const context=vm.createContext({URLSearchParams,Response,Request});
  const registry=new vm.SourceTextModule(sourceText,{context,identifier:entry});
  const index=new vm.SourceTextModule(indexSource,{context,identifier:'scope-route-index'});
  const ui=new vm.SyntheticModule(['UI_COPY'],function(){this.setExport('UI_COPY',stubUi)},{context,identifier:'ui-copy'});
  const resolve=id=>{
    if(id==='scope-route-index'||id==='./scope-route-index.js'||id==='../../modular/scope-route-index')
      return index;
    if(id==='../i18n/ui-copy.js')return ui;
    throw new Error('Unexpected import: '+id);
  };
  await registry.link(resolve);
  await registry.evaluate();
  return registry.namespace;
}

test('every active api.manage Scope has a public JS routing record',async()=>{
  const routes=await load(indexSource,'scope-route-index');
  const all=routes.SCOPE_ROUTE_INDEX;
  assert.deepEqual(Array.from(all.map(row=>row.scope_id)).sort(),['lo3rwang','loc','lrunes']);
  for(const row of all){
    assert.equal(Boolean(row.domain)!==Boolean(row.directory),true,row.scope_id);
    assert.equal(row.active,true);
    assert.equal('email' in row,false,'Do not leak management fields');
  }
});

test('directory Scope wins over its parent domain before bootstrap/SQL',async()=>{
  const h=await load(source,'scope-registry');
  assert.equal(h.resolveScope('loc.lo3rwang.cc','/'), 'loc');
  assert.equal(h.resolveScope('loc.lo3rwang.cc','/lo3rwang/'),'lo3rwang');
  assert.equal(h.resolveScope('loc.lo3rwang.cc','/lo3rwang/search/'),'lo3rwang');
  assert.equal(h.resolveScope('lrunes.lo3rwang.cc','/lo3rwang/'),'lrunes');
  // LOC-hosted built-in /lrunes application must keep its own Scope identity.
  assert.equal(h.resolveScope('loc.lo3rwang.cc','/lrunes/'),'lrunes');
  assert.equal(h.resolveScope('loc.lo3rwang.cc','/lrunes/card/list/?d=3d'),'lrunes');
  assert.equal(h.resolveScope('loc.lo3rwang.cc','/lrunes/manage/'),'lrunes');
  assert.equal(h.resolveScope('loc.lo3rwang.cc','/lrunes-other/'),'loc');
  assert.equal(h.resolveScope('lrunes.lo3rwang.cc','/'),'lrunes');
  assert.equal(h.resolveScope('localhost','/lrunes/'),'lrunes');
  assert.equal(h.scopeHref('lo3rwang','search'),'https://loc.lo3rwang.cc/lo3rwang/search/');
  assert.equal(h.scopeHref('lrunes','search'),'https://lrunes.lo3rwang.cc/search/');
});

test('ISR CORS public origins come only from the JS route file',async()=>{
  const cors=await load(corsSource,'_cors');
  for(const origin of ['https://loc.lo3rwang.cc','https://lrunes.lo3rwang.cc','https://esotericverse.github.io']){
    const req=new Request('https://isr.lo3rwang.cc/api/loc/site-bootstrap',{headers:{Origin:origin}});
    const response=cors.withLocCors(Response.json({ok:true}),req);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'),origin);
    assert.equal(cors.locCorsPreflight(req).status,204);
  }
  const denied=new Request('https://isr.lo3rwang.cc/api/loc/site-bootstrap',{headers:{Origin:'https://malicious.example'}});
  assert.equal(cors.locCorsPreflight(denied).status,403);
});

test('LOC homepage uses its configured Theme instead of aggregate auto fallback',()=>{
  const shell=read('app/AppShell.jsx');
  assert.ok(shell.includes("(scope.id==='loc'||!scope.aggregateChildren)"),
    'LOC is a Group but still owns its own configured Theme in silver.loc');
  assert.ok(shell.includes('const configuredDefaultThemeId=configuredTheme===SYSTEM_THEME_ID?'),
    'System default remains independent of a concrete configured Theme');
});

test('Rune homepage uses the same authorized edit entry as every other Scope home',()=>{
  const shell=read('app/AppShell.jsx');
  const runes=read('app/lrunes/RunesClient.jsx');
  const shared=read('app/loc/ScopeHomeEditEntry.jsx');
  assert.ok(shell.includes('{showHomeEditEntry?<ScopeHomeEditEntry key={scopeId}/>:null}'),
    'Shared homepage edit entry must apply to Rune as well');
  assert.ok(!runes.includes('ScopeHomeEditEntry'),
    'Do not insert a second Rune-specific entry into its page');
  assert.ok(shared.includes('canManageScopeSync(scopeId)'),
    'Rune editing must use normal Scope permission checks');
  assert.ok(runes.includes('scopeId="lrunes"')&&runes.includes('page="hero"'),
    'Shared edit mode must retain the Rune-only Hero Blocks');
});
