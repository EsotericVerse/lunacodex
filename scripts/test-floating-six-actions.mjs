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
