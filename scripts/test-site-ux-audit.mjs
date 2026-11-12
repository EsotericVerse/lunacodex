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

test('Global NAV has one scrolling owner and preserves its normal-flow DOM',()=>{
  const nav=read('app/styles/nav.css');
  const ui=read('app/styles/uiux.css');
  const old=read('app/styles/scope-system.css');
  const app=read('app/AppShell.jsx');
  const viewport=read('app/modular/ScrollableScopeNav.jsx');
  const imports=read('app/globals.css');
  assert.match(nav,/\.scope-nav\{[\s\S]*?overflow:visible;/);
  assert.match(nav,/\.scope-nav-viewport\{[\s\S]*?overflow-x:auto;[\s\S]*?overflow-y:hidden;/);
  assert.doesNotMatch(old,/\.scope-nav\{overflow-x:auto\}/);
  assert.doesNotMatch(ui,/\.scope-nav::-webkit-scrollbar/);
  assert.doesNotMatch(ui,/\.scope-search\{/);
  assert.match(app,/className="scope-global"/);
  assert.match(app,/className="scope-nav"/);
  assert.match(viewport,/className="scope-nav-viewport"/);
  assert.ok(imports.indexOf('@import "./styles/nav.css"')>imports.indexOf('@import "./styles/uiux.css"'));
  assert.match(nav,/\.scope-global\[data-native="ios"\]/);
});

test('iPhone navigation controls are touch-sized and metadata fields do not trigger Safari focus zoom',()=>{
  const nav=read('app/styles/nav.css');
  const fields=read('app/styles/features.css');
  const dock=read('app/styles/bottom-navigation.css');
  const layout=read('app/layout.jsx');
  // Favorites scroll within .scope-nav-viewport; outside arrows and LOC return
  // must each remain a full 44px touch target on narrow screens.
  assert.match(nav,/@media\(max-width:760px\)\{[\s\S]*?\.scope-nav-loc-home\{min-width:44px;min-height:44px;[\s\S]*?\.scope-nav-arrow,\.scope-nav-close-folder\{min-width:44px;min-height:44px;/);
  assert.match(fields,/@media\(max-width:760px\)\{\s*\.scope-search-attr-item :is\(input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\),textarea\),[\s\S]*?font-size:1rem;/);
  assert.match(dock,/bottom:calc\(\.55rem \+ env\(safe-area-inset-bottom,0px\)\)/);
  assert.match(dock,/grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
  assert.match(layout,/viewportFit:'cover'/);
  assert.doesNotMatch(fields,/\.scope-blocknote \.bn-editor\{[^}]*overflow:hidden/s);
});
