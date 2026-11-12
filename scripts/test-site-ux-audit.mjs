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

test('mobile Search, Statistics and Trace keep readable controls in constrained frames',()=>{
  const feature=read('app/styles/features.css');
  const publicStyles=read('app/styles/public-features.css');
  const traceStyles=read('app/styles/loc-ui-refresh.css');
  const search=read('app/modular/features/Search.jsx');
  const statistics=read('app/modular/features/Statistics.jsx');
  const trace=read('app/modular/features/Trace.jsx');
  const territory=read('app/modular/features/trace/TraceTerritoryPanel.jsx');
  // Date controls must reflow from their available panel width, not fixed phone breaks.
  assert.match(feature,/\.scope-search-date-fields\{grid-template-columns:repeat\(auto-fit,minmax\(min\(100%,16rem\),1fr\)\)\}/);
  assert.match(search,/className="scope-search-filter-body scope-search-date-fields"/);
  // All three in-map report tabs stay mounted in a row, but labels can wrap.
  assert.match(feature,/\.loc-trace-float-tabs\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(feature,/\.loc-trace-float-tabs>\.loc-button\{[^}]*min-height:44px;[^}]*white-space:normal;overflow-wrap:anywhere/s);
  assert.match(trace,/className="loc-trace-float-tabs"/);
  // Factual source labels may not disappear behind an ellipsis on phones.
  assert.match(publicStyles,/@media\(max-width:980px\)\{[\s\S]*?\.statistics-dashboard__breakdown-label>:is\(span,a\)\{[^}]*white-space:normal;overflow:visible;text-overflow:clip/s);
  assert.match(statistics,/className="statistics-dashboard__breakdown-label"/);
  assert.match(traceStyles,/\.loc-trace-territory-toolbar>label select\{min-height:44px;font-size:1rem\}/);
  assert.match(traceStyles,/\.loc-trace-territory-time input\{width:100%;min-height:44px;/);
  assert.match(territory,/className="loc-trace-territory-time"/);
});

test('mobile edit dock and Trace territory keep all return/focus targets unobscured',()=>{
  const dock=read('app/styles/bottom-navigation.css');
  const territory=read('app/styles/loc-ui-refresh.css');
  const responsive=read('app/styles/responsive.css');
  const shell=read('app/AppShell.jsx');
  const map=read('app/modular/features/trace/TraceMap.jsx');
  const territoryView=read('app/modular/features/trace/TraceTerritoryPanel.jsx');
  // The pending edit state renders one span, not six independent actions.
  assert.match(shell,/editDockPending\?<span role="status" className="scope-edit-dock-pending"/);
  assert.match(dock,/\.scope-feature-dock \.scope-edit-dock-pending\{[^}]*grid-column:1\/-1;[^}]*min-width:0;[^}]*max-width:100%;/s);
  // All three scroll/focus surfaces use the same clearance, including notices.
  assert.match(dock,/html\{[^}]*--loc-dock-clearance:calc\(6\.5rem \+ env\(safe-area-inset-bottom,0px\)\);[^}]*scroll-padding-bottom:var\(--loc-dock-clearance\)/s);
  assert.match(dock,/html:has\(\.scope-feature-dock \.scope-edit-dock-notice\)\{[^}]*--loc-dock-clearance:calc\(11rem \+ env\(safe-area-inset-bottom,0px\)\)/s);
  assert.match(dock,/body\{padding-bottom:var\(--loc-dock-clearance\);\}/);
  assert.match(dock,/:where\(a,button,input,select,textarea,\[tabindex\]\):focus\{[^}]*scroll-margin-bottom:var\(--loc-dock-clearance\)/s);
  // Both route report and territory dossier leave a lane for the lower-right
  // map return action instead of allowing the higher z-index report to cover it.
  assert.match(responsive,/\.loc-trace-map-shell\.is-public-trace \.loc-trace-floating-content\{[^}]*bottom:calc\(3\.65rem \+ env\(safe-area-inset-bottom,0px\)\)/s);
  assert.match(territory,/@media\(max-width:680px\)\{[\s\S]*?\.loc-trace-territory \.loc-trace-floating-content\{[^}]*top:auto;\s*bottom:calc\(3\.65rem \+ env\(safe-area-inset-bottom,0px\)\)/);
  assert.match(map,/className="loc-button loc-trace-origin-button"/);
  assert.match(territoryView,/className="loc-trace-territory"/);
});

test('BlockNote contenteditable focus inherits dock clearance on iPhone',()=>{
  const css=read('app/styles/bottom-navigation.css');
  const editor=read('app/loc/BlockNoteEditorClient.jsx');
  assert.match(css,/:where\(a,button,input,select,textarea,\[tabindex\],\s*\.scope-blocknote\.is-editable \[contenteditable="true"\]\):focus\{\s*scroll-margin-bottom:var\(--loc-dock-clearance\)/);
  assert.match(css,/html:has\(\.scope-feature-dock \.scope-edit-dock-notice\)\{[^}]*--loc-dock-clearance:calc\(11rem \+ env\(safe-area-inset-bottom,0px\)\)/s);
  assert.match(editor,/<BlockNoteView\s+editor=\{editor\}/);
});
