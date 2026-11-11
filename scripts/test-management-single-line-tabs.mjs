import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const component=read('app/modular/ManagementSectionNav.jsx');
const css=read('app/styles/settings-select.css');

test('Group, Scope, and personal settings use exactly one React category tab component',()=>{
  for(const path of [
    'app/loc/views/AdminHomeView.jsx',
    'app/loc/LocSourceManagement.jsx',
    'app/loc/ScopeManagement.jsx',
    'app/loc/SearchManagement.jsx',
    'app/loc/GlobalSettings.jsx',
    'app/loc/FeatureSettingsPage.jsx',
    'app/loc/KeywordLibraryPanel.jsx',
    'app/modular/features/CultureTimelineEditor.jsx'
  ])assert.match(read(path),/ManagementSectionNav/,'missing shared navigator: '+path);
  assert.match(component,/aria-pressed=\{selected\}/);
  assert.match(component,/onClick=\{\(\)=>\{if\(!selected\)onChange\(item.value\);\}\}/);
});

test('category tabs remain one horizontal scrolling row on desktop and mobile',()=>{
  const contract=css.slice(css.indexOf('A single management tab contract'));
  assert.match(contract,/flex-flow:row nowrap/);
  assert.match(contract,/overflow-x:auto/);
  assert.match(contract,/scrollbar-width:thin/);
  assert.match(contract,/flex:0 0 auto/);
  assert.match(contract,/@media\(max-width:820px\)/);
  assert.match(contract,/@media\(max-width:400px\)/);
  assert.doesNotMatch(contract,/flex-wrap:wrap/);
});

test('native keyword editor reads eight-character Anchor UIDs and writes new UID8',()=>{
  const tree=read('app/loc/keyword-tree.mjs');
  const kw=read('app/loc/KeywordLibraryPanel.jsx');
  const db=read('app/loc/db-contract.mjs');
  assert.match(tree,/const UID=\/\^\[0-9A-Za-z\]\{4\}\(\?:\[0-9A-Za-z\]\{4\}\)\?\$\/;/);
  assert.match(kw,/allocateAnchorUid\(new Set\(rows.map\(row=>String\(row.uid\)\)\)\)/);
  assert.match(db,/scope==='lo3rwang'\?allocateAnchorUid/);
  assert.match(kw,/id="scope-keyword-sections"/);
});

test('phone management navigation is explicit and source changes save through the six-key dock',()=>{
  const mobileCss=read('app/styles/loc-ui-refresh.css');
  assert.match(component,/mobileSelect=false/);
  assert.match(component,/management-section-nav__mobile-picker/);
  assert.match(component,/availableSections/);
  assert.match(mobileCss,/management-section-nav--mobile-select/);
  assert.match(mobileCss,/min-height:48px/);
  for(const path of [
    'app/loc/views/AdminHomeView.jsx',
    'app/loc/ScopeManagement.jsx',
    'app/loc/SearchManagement.jsx',
    'app/loc/GlobalSettings.jsx'
  ])assert.match(read(path),/mobileSelect/,'missing mobile picker: '+path);
  const source=read('app/loc/SourceCategoryEditor.jsx');
  assert.match(source,/useEditDockForm\(\{save,isDirty/);
  assert.doesNotMatch(source,/onClick=\{save\}/);
  assert.match(source,/canChangeNode/);
});
