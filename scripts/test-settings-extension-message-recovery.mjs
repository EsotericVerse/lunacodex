import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('Settings feature selection does not fetch a deferred page module',()=>{
  const settings=read('app/loc/GlobalSettings.jsx');
  const feature=read('app/loc/FeatureSettingsPage.jsx');
  assert.match(settings,/import FeatureSettingsPage from '\.\/FeatureSettingsPage'/);
  assert.match(settings,/activeSection==='features'\?<FeatureSettingsPage embedded\/>/);
  assert.doesNotMatch(settings,/dynamic\(\(\)=>import\('\.\/FeatureSettingsPage'/);
  assert.match(feature,/import LocUserSettingsPanel from '\.\/LocUserSettingsPanel'/);
  assert.doesNotMatch(feature,/dynamic\(\(\)=>import\('\.\/LocUserSettingsPanel'/);
});
test('Website Clerk bridge surfaces actual Chrome runtime errors',()=>{
  const source=read('public/extension/website-bridge.mjs');
  assert.match(source,/chrome\.runtime\.lastError\?\.message/);
  assert.match(source,/Chrome Extension 通訊失敗/);
  assert.match(source,/並重新載入/);
});
