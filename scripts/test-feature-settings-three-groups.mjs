import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const root='app/i18n/sections/uiExtra.globalSettings.';
const locales=await Promise.all(['zh_tw','zh_cn','en','ja'].map(async lang=>
  (await import('../'+root+lang+'.js')).default));

test('Settings has a separate Feature Settings route on web and device paths',()=>{
  const rootSettings=read('app/loc/GlobalSettings.jsx');
  const featurePage=read('app/loc/FeatureSettingsPage.jsx');
  assert.ok(rootSettings.includes("option('features'"));
  assert.ok(rootSettings.includes("router.push(featuresHref)"));
  assert.ok(rootSettings.includes('/local/settings/features/'));
  assert.ok(!rootSettings.includes('LocUserSettingsPanel'));
  assert.ok(!rootSettings.includes('timeFilterTitle'));
  assert.ok(featurePage.includes('return <FeaturePage featureId="setting">'));
  assert.ok(featurePage.includes('<ManagementSectionNav'));
  for(const path of ['app/local/settings/features/page.jsx','app/settings/features/page.jsx']){
    const route=read(path);
    assert.ok(route.includes('FeatureSettingsPage'));
    assert.ok(route.includes('noIndex:true'));
  }
});

test('Feature Settings shows exactly three mutually exclusive groups',()=>{
  const feature=read('app/loc/FeatureSettingsPage.jsx');
  const panel=read('app/loc/LocUserSettingsPanel.jsx');
  for(const key of ["value:'filter'","value:'cultureTrace'","value:'staticsSearch'"])
    assert.ok(feature.includes(key));
  for(const line of ["filter:[]","cultureTrace:['culture','trace']","staticsSearch:['statics','search']"])
    assert.ok(panel.includes(line));
  assert.ok(panel.includes('FIELDS.filter(group=>(SELECTED[section]||[]).includes(group.key))'));
  assert.ok(panel.includes("if(section!=='filter'||!ready||!data?.uid)return undefined"));
  assert.ok(feature.includes("section==='filter'?<section"));
  assert.ok(feature.includes('saveDefaultTimeUnit(event.target.value)'));
  assert.ok(panel.includes('void update(group,next[group])'));
  assert.ok(!panel.includes('GROUPS.map(group=>'));
});

test('Settings fields, choices, states and group tabs have complete locale coverage',()=>{
  const texts=[
    read('app/loc/FeatureSettingsPage.jsx'),
    read('app/loc/LocUserSettingsPanel.jsx'),
    read('app/loc/GlobalSettings.jsx')
  ].join('\n');
  const keys=new Set(['featureSettings','featureSettingsShort','featureSettingsDescription']);
  for(const pattern of [/(?:KEY|PATH)\+'([A-Za-z0-9]+)'/g,/(?:title|key):'(cultureSettings|cultureTime|cultureDisplay|cultureUnit|cultureSort|staticsSettings|staticsDisplay|staticsUnit|staticsSort|traceSettings|traceDisplay|traceTime|traceSort|searchSettings|searchField|searchSort|pref[A-Za-z0-9]+)'/g]){
    for(const match of texts.matchAll(pattern))keys.add(match[1]);
  }
  // Dynamic timeUnit + suffix resolves to existing timeUnitAuto/Day/Week/Month/Year.
  keys.delete('timeUnit');
  for(const match of texts.matchAll(/\['[^']+','(pref[A-Za-z0-9]+)'\]/g))
    keys.add(match[1]);
  for(const lang of locales){
    for(const key of keys)assert.equal(typeof lang[key],'string','Missing locale setting key: '+key);
    for(const key of ['featureFilter','featureCultureTrace','featureStaticsSearch','featureKeywordGroup'])
      assert.ok(lang[key].trim().length,'Missing group label: '+key);
  }
  const [zh,,en,ja]=locales;
  assert.notEqual(zh.featureCultureTrace,en.featureCultureTrace);
  assert.notEqual(zh.featureStaticsSearch,ja.featureStaticsSearch);
  assert.ok(!texts.includes('已儲存的個人選項會直接套用'));
});
