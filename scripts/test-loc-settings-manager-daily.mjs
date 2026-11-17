import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('Settings dashboard contains only login and one manager control',()=>{
  const settings=read('app/loc/preferences/FeatureSettingsPage.jsx');
  assert.match(settings,/\{accountCard\}/);
  assert.match(settings,/控制選項/);
  assert.match(settings,/role="switch"/);
  assert.match(settings,/管理者/);
  assert.doesNotMatch(settings,/LocUserSettingsPanel|ManagementSectionNav|DEFAULT_TIME_UNITS|saveDefaultTimeUnit|selectAvailableKeywordClasses/);
  assert.doesNotMatch(settings,/featureSaveHint|featureAppliedHint|文化設定|統計設定|痕跡設定|搜尋設定/);
});

test('Manager control is not an access grant or permission lookup',()=>{
  const hook=read('app/loc/preferences/use-search-manager-switch.js');
  assert.match(hook,/window\.sessionStorage\.setItem/);
  assert.match(hook,/window\.dispatchEvent\(new CustomEvent/);
  assert.doesNotMatch(hook,/api\.manage|canLocAccess|signIn|managedAction|grant\(/i);
  const settings=read('app/loc/preferences/FeatureSettingsPage.jsx');
  assert.match(settings,/onChange=\{event=>setEnabled\(event\.target\.checked\)\}/);
});

test('Search applies the preference at query time, not on toggle',()=>{
  const search=read('app/modular/features/Search.jsx');
  assert.match(search,/useSearchManagerSwitch\(/);
  assert.match(search,/if\(adminSearchActive\|\|adminSwitchExplicit\)/);
  assert.match(search,/getAccountSession\(\)/);
  assert.match(search,/await saveLocUserField/);
  assert.match(search,/const searchRunner=searchGalaxyRows/);
  assert.doesNotMatch(search,/const searchRunner=managerAtSearch\?searchAuthorizedGalaxyRows/);
  assert.match(search,/setPrivateResultMode\(managerAtSearch\|\|managementMode\)/);
  assert.match(search,/account\.refresh\(\{forceVerify:true\}\)/);
});

test('Settings Daily Rune is lazily mounted, retired on tab change and month reads bounded',()=>{
  const global=read('app/loc/preferences/GlobalSettings.jsx');
  const nav=read('app/modular/ManagementSectionNav.jsx');
  const daily=read('app/loc/runes/daily-runes.js');
  assert.match(global,/const DailyRuneCalendarSettings=dynamic/);
  assert.match(global,/activeSection==='dailyRune'\?<DailyRuneCalendarSettings\/>/);
  assert.match(nav,/prepareTransientResourceAction\('management'\)/);
  const month=daily.slice(daily.indexOf('export async function selectDailyRuneMonth'),daily.indexOf('const DAILY_DRAW_KINDS'));
  assert.match(month,/selectRows\('silver\.lrunes_daily'/);
  assert.match(month,/limit:100,offset:0/);
  assert.doesNotMatch(month,/selectDailyRangeRows\(/);
});

test('Signing out clears the device-only manager toggle',()=>{
  const global=read('app/loc/preferences/GlobalSettings.jsx');
  assert.match(global,/await account\.signOut\(\);\s*clearSearchManagerSwitch\(\)/);
});
