import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {THEME_TOKEN_KEYS,publishedThemeCssHref,activatePublishedTheme}
  from '../app/modular/theme-registry.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('global stylesheet no longer contains eight complete Themes',()=>{
  assert.doesNotMatch(read('app/globals.css'),/published-themes\.css/);
  const layout=read('app/layout.jsx');
  assert.ok(layout.includes("link.href='/themes/'+themeId+'.css'"));
  assert.ok(layout.includes("link.setAttribute('blocking','render')"));
  assert.ok(layout.includes("window.sessionStorage.getItem('loc-user-theme-selection-v1')"));
});

test('all eight CSS files are independent, complete, and match published tokens',()=>{
  for(let i=1;i<=8;i++){
    const path='public/themes/theme-'+i+'.css';
    const css=read(path);
    const json=JSON.parse(read('app/modular/themes/theme-'+i+'.json'));
    assert.ok(css.includes(':root[data-theme-id="theme-'+i+'"][data-theme]{'));
    assert.equal([...css.matchAll(/:root\[data-theme-id="theme-[1-8]"/g)].length,1);
    for(const token of THEME_TOKEN_KEYS){
      const column=token.slice(2).replaceAll('-','_');
      const value=String(json[column]??'').trim();
      assert.ok(value,'missing JSON token '+path+' '+token);
      assert.ok(css.includes(token+':'+value+';'),'mismatched CSS '+path+' '+token);
    }
    assert.doesNotMatch(css,/@import|!important|url\s*\(/);
    assert.equal(publishedThemeCssHref('theme-'+i),'/themes/theme-'+i+'.css');
  }
  assert.equal(publishedThemeCssHref('theme-0'),null);
  assert.equal(publishedThemeCssHref('theme-9'),null);
  assert.equal(publishedThemeCssHref('system-default'),null);
});

test('public Theme only loads CSS, publisher generates one CSS per ID',()=>{
  const shell=read('app/AppShell.jsx');
  const data=read('app/loc/preferences/theme-data.js');
  const generator=read('scripts/generate-public-blocks.mjs');
  assert.ok(shell.includes('activatePublishedTheme(effectiveThemeId)'));
  assert.doesNotMatch(shell,/selectThemeOverride|activePalette/);
  assert.doesNotMatch(data,/PALETTE_LOADERS|import\('\.\.\/\.\.\/modular\/themes/);
  assert.ok(generator.includes("'public/themes/theme-'+id+'.css'"));
  assert.doesNotMatch(generator,/app\/styles\/published-themes\.css/);
});

function fakeDom(initialId='theme-8',loaded=true){
  const nodes=[];
  const makeNode=()=>({
    dataset:{},id:'',rel:'',href:'',sheet:null,isConnected:false,
    events:new Map(),
    addEventListener(type,fn){this.events.set(type,fn)},
    removeEventListener(type,fn){if(this.events.get(type)===fn)this.events.delete(type)},
    emit(type){this.events.get(type)?.()},
    remove(){
      const i=nodes.indexOf(this);
      if(i>=0)nodes.splice(i,1);
      this.isConnected=false;
    }
  });
  const initial=makeNode();
  initial.id='loc-theme-stylesheet';
  initial.dataset.themeId=initialId;
  initial.dataset.loaded=loaded?'true':'';
  if(loaded)initial.sheet={};
  initial.isConnected=true;
  nodes.push(initial);
  const root={dataset:{themeId:initialId,theme:'dark'},style:{
    colorScheme:'dark',removeProperty(){}
  }};
  const dom={
    documentElement:root,
    head:{appendChild(node){node.isConnected=true;nodes.push(node);return node}},
    createElement(tag){assert.equal(tag,'link');return makeNode()},
    getElementById(id){return nodes.find(node=>node.id===id)||null}
  };
  return {dom,nodes};
}

test('repeated navigation to the same Scope Theme never adds a link',async()=>{
  const previous=globalThis.document;
  const {dom,nodes}=fakeDom();
  globalThis.document=dom;
  try{
    assert.equal(await activatePublishedTheme('theme-8'),true);
    assert.equal(await activatePublishedTheme('theme-8'),true);
    assert.equal(nodes.length,1);
  }finally{globalThis.document=previous}
});

test('Theme switching waits for CSS, coalesces requests and ignores stale loads',async()=>{
  const previous=globalThis.document;
  const {dom,nodes}=fakeDom();
  globalThis.document=dom;
  try{
    const requestA=activatePublishedTheme('theme-4');
    assert.equal(dom.documentElement.dataset.themeId,'theme-8');
    assert.equal(nodes.length,2);
    assert.equal(nodes[1].href,'/themes/theme-4.css');
    assert.strictEqual(activatePublishedTheme('theme-4'),requestA);
    assert.equal(nodes.length,2);
    const requestB=activatePublishedTheme('theme-2');
    assert.equal(await requestA,false);
    assert.equal(nodes.length,2);
    assert.equal(dom.documentElement.dataset.themeId,'theme-8');
    nodes[1].emit('load');
    assert.equal(await requestB,true);
    assert.equal(nodes.length,1);
    assert.equal(nodes[0].dataset.themeId,'theme-2');
    assert.equal(dom.documentElement.dataset.themeId,'theme-2');
    assert.equal(await activatePublishedTheme('theme-2'),true);
    assert.equal(nodes.length,1);
  }finally{globalThis.document=previous}
});

test('failed Theme download retains currently visible CSS',async()=>{
  const previous=globalThis.document;
  const {dom,nodes}=fakeDom();
  globalThis.document=dom;
  try{
    const request=activatePublishedTheme('theme-1');
    nodes[1].emit('error');
    assert.equal(await request,false);
    assert.equal(nodes.length,1);
    assert.equal(dom.documentElement.dataset.themeId,'theme-8');
  }finally{globalThis.document=previous}
});

test('parser-time pending stylesheet is reused rather than requested again',async()=>{
  const previous=globalThis.document;
  const {dom,nodes}=fakeDom('theme-5',false);
  globalThis.document=dom;
  try{
    const request=activatePublishedTheme('theme-5');
    assert.equal(nodes.length,1);
    nodes[0].sheet={};
    nodes[0].emit('load');
    assert.equal(await request,true);
    assert.equal(nodes.length,1);
    assert.equal(dom.documentElement.dataset.themeId,'theme-5');
  }finally{globalThis.document=previous}
});
