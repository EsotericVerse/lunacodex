import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const shell=readFileSync(new URL('../app/AppShell.jsx',import.meta.url),'utf8');
const dock=readFileSync(new URL('../app/modular/edit-dock.jsx',import.meta.url),'utf8');
const css=readFileSync(new URL('../app/styles/bottom-navigation.css',import.meta.url),'utf8');

test('normal and edit mode share the fixed bottom floating six-button dock',()=>{
  assert.doesNotMatch(shell,/className="scope-top-feature-nav"/);
  assert.match(shell,/className="scope-feature-dock scope-floating-edit-buttons"/);
  assert.match(shell,/editingDockVisible\?editTabs\.map\(tab=>tab\.action/);
  assert.match(shell,/:featureTabs\.map\(tab=><ScopeLink/);
  assert.match(css,/position:fixed;z-index:140/);
  assert.match(css,/grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
});

test('edit takeover keeps save first, cancel last, and reuses all dirty form handlers',()=>{
  assert.match(shell,/const editTabs=\[\s*\{id:'save'/);
  assert.match(shell,/\.\.\.editDestinations,\s*\{id:'cancel'/);
  assert.match(shell,/editDock\.save\(\)/);
  assert.match(shell,/editDock\.discard\(/);
  assert.match(dock,/const dirty=\[\.\.\.registeredEditors\.current\]\.filter\(editor=>editor\.isDirty\?\.\(\)\)/);
  assert.match(dock,/for\(const editor of editors\)/);
  assert.match(dock,/if\(saved!==true\)throw new Error/);
});

test('six feature icons have unique single-shot Motion signatures and unchanged SVGs',async()=>{
  const {parse}=await import('@babel/parser');
  const icons=readFileSync(new URL('../app/modular/BottomNavIcon.jsx',import.meta.url),'utf8');
  assert.ok(parse(icons,{sourceType:'module',plugins:['jsx']}).program.body.length>0);
  assert.ok(parse(shell,{sourceType:'module',plugins:['jsx']}).program.body.length>0);
  assert.match(icons,/import \{motion,useReducedMotion\} from 'motion\/react'/);
  for(const key of ['home','culture','statics','trace','search','settings'])
    assert.match(icons,new RegExp('  '+key+':\\{initial:'));
  assert.match(icons,/name==='phone'\?'home':name/);
  assert.match(icons,/const play=active&&!reduceMotion/);
  assert.match(icons,/transition=\{\{duration:play\?effect\.duration:0,ease:'easeOut'\}\}/);
  assert.match(icons,/className="scope-dock-motion-icon__home-frame"/);
  assert.match(icons,/className="scope-dock-motion-icon__digits"/);
  assert.match(icons,/rotate:\[0,360\]/);
  assert.match(icons,/scaleX:\[\.15,1\.13,1\]/);
  assert.doesNotMatch(icons,/repeat:Infinity|setInterval\(|setTimeout\(/);
  assert.match(icons,/export default function BottomNavIcon\(\{name\}\)/);
});
test('dock links keep immediate routing, focus and 6 columns; editor actions stay untouched',()=>{
  assert.match(shell,/onClick=\{\(\)=>setDockActivation\(prev=>\(\{id:tab\.id,count:prev\.count\+1\}\)\)\}/);
  assert.match(shell,/<DockMotionIcon name=\{tab\.icon\}/);
  assert.match(shell,/activation=\{dockActivation\.id===tab\.id\?dockActivation\.count:0\}/);
  assert.match(shell,/aria-current=\{tab\.id==='settings'/);
  assert.match(shell,/<BottomNavIcon name=\{tab\.icon\}\/><span>\{tab\.label\}<\/span>/);
  assert.match(css,/\.scope-feature-dock :is\(a,button\)>\\.scope-dock-motion-icon\{/);
  assert.match(css,/width:24px;height:24px/);
  assert.match(css,/pointer-events:none/);
  assert.doesNotMatch(shell,/preventDefault\(\)|setTimeout\([^]*?navigationHref/);
});
