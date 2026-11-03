import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('Search input uses valid ARIA, suggestion control supports touch and keyboard',()=>{
  const source=read('app/modular/features/Search.jsx');
  const field=source.split('<input id="scope-search-query"')[1]?.split('/>')[0];
  assert.ok(field,'Search input must exist');
  assert.doesNotMatch(field,/aria-expanded=/,'plain text input cannot expose aria-expanded without combobox role');
  assert.match(source,/className="loc-button scope-search-popular-toggle"/);
  assert.match(source,/aria-controls="scope-search-suggestions"/);
  assert.match(source,/id="scope-search-suggestions"/);
});

test('Shared dock and Clerk credit maintain readable contrast',()=>{
  const css=read('app/styles/bottom-navigation.css');
  assert.match(css,/\.scope-feature-dock a\[aria-current="page"\]\{[^}]*background:color-mix\(in srgb,var\(--loc-accent\) 23%,var\(--loc-panel\) 77%\)/s);
  const login=read('public/login/appearance.css');
  assert.match(login,/#login-root \.cl-footer \[data-variant="buttonSmall"\]\[data-color="inherit"\]/);
});

test('LOC and author home pages expose a main content landmark',()=>{
  const app=read('app/loc/LocApp.jsx');
  const author=read('app/loc/views/AuthorHomeView.jsx');
  assert.match(app,/role=\{forcedView==='home'&&\['loc','lo3rwang'\]\.includes\(scopeId\)\?'main':undefined\}/);
  assert.match(author,/return <main className="loc-view scope-home-composition">/);
});
