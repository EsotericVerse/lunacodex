import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('Web and native Scope NAV use canonical order with Rune leftmost',()=>{
  const shell=read('app/AppShell.jsx');
  const registry=read('app/modular/routing/scope-registry.js');
  assert.match(registry,/id:'lrunes'[\s\S]*?nav:Object\.freeze\(\{position:'before',order:1/);
  assert.match(shell,/const NAV_SCOPES=Object\.values\(SCOPES\)/);
  assert.match(shell,/\.sort\(\(a,b\)=>String\(a\.nav\.position\)/);
  assert.match(shell,/\.filter\(item=>item\.id!=='loc'&&item\.id!=='admin'\)/);
  assert.doesNotMatch(shell,/NavigationPreferences|favorite_scopes|favorite_folders/);
  assert.match(shell,/navigationHref\(item\.id,'',native\)/);
  const home=read('app/lrunes/page.jsx');
  const portal=read('app/loc/views/LrsPortalView.jsx');
  assert.match(registry,/if\\(!native&&normalizeScopeId\\(scopeId\\)==='lrunes'\\)/);
  assert.match(registry,/scopeHref\\('loc','lrunes\\/'/);
  assert.match(home,/LocApp forcedView="home" forcedScope="lrunes"/);
  assert.doesNotMatch(home,/LrsWebRedirect/);
  assert.doesNotMatch(portal,/location\\.replace|lrs\\.lo3rwang\\.cc/);
  assert.match(shell,/navigationScopes\.push\(\{id:MOBILE_HOME_ID/);
  assert.match(shell,/mobileHomeHref\(native\)/);
});
test('No favorite code module or favorite CSS remains',()=>{
  assert.equal(existsSync(new URL('../app/modular/navigation-preferences.js',import.meta.url)),false);
  const settingsCss=read('app/styles/settings-select.css');
  const navCss=read('app/styles/nav.css');
  assert.doesNotMatch(settingsCss,/scope-settings-favorite-/);
  assert.doesNotMatch(navCss,/scope-favorite-/);
});
test('Retired navigation columns cannot be read or changed via personal setting APIs',()=>{
  const preferences=read('app/loc/preferences/user-storage.js');
  const server=read('app/loc/providers/kysely-personal.mjs');
  assert.doesNotMatch(preferences,/favorite_scopes|favorite_folders|home_scope|loc-favorite-|loc-home-scope/);
  assert.doesNotMatch(server,/favorite_scopes|favorite_folders|home_scope/);
  assert.match(preferences,/loc-locale-v1/);
});
test('Mobile and web settings share the same one-switch homepage',()=>{
  const web=read('app/settings/page.jsx');
  const native=read('app/local/settings/page.jsx');
  const global=read('app/loc/preferences/GlobalSettings.jsx');
  const panel=read('app/loc/preferences/FeatureSettingsPage.jsx');
  assert.match(web,/GlobalSettings/);
  assert.match(native,/GlobalSettings/);
  assert.match(global,/activeSection==='features'\?<FeatureSettingsPage embedded dashboard accountCard=\{accountCard\}\/>/);
  assert.match(panel,/控制選項/);
  assert.match(panel,/role="switch"/);
  assert.doesNotMatch(panel,/LocUserSettingsPanel|DEFAULT_TIME_UNITS/);
});
