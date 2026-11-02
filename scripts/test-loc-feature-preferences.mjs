import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cultureDensityByUnit,simpleTimeRiver,traceHomeMapChoices,nearestTracePlaceIds} from '../app/loc/loc-feature-preferences.mjs';
test('Culture calendar units aggregate only fetched buckets, not dates in stored Anchor',()=>{
 const source=[{category:'a',start_date:'2026-11-01',item_count:2},
 {category:'a',start_date:'2026-11-02',item_count:3},
 {category:'b',start_date:'2026-11-02',item_count:5}];
 assert.strictEqual(cultureDensityByUnit(source,'day'),source);
 assert.deepEqual(cultureDensityByUnit(source,'week').map(x=>[x.category,x.start_date,x.item_count]),
   [['a','2026-10-26',2],['a','2026-11-02',3],['b','2026-11-02',5]]);
 assert.deepEqual(cultureDensityByUnit(source,'month').map(x=>[x.category,x.item_count]),[['a',5],['b',5]]);
});
test('Culture time display selects saved Anchor or Period records without inventing dates',()=>{
 const rows=[{uid:'ABC12345',scope_id:'lo3rwang',entry_type:'anchor',start_date:'2026-11-02'},
 {uid:'PER12345',scope_id:'lo3rwang',entry_type:'period',title:'週期',ranges:[{start_date:'2026-11-01',end_date:'2026-11-02'}]}];
 assert.equal(simpleTimeRiver(rows,'anchor').items[0].uid,'ABC12345');
 assert.equal(simpleTimeRiver(rows,'period').items[0].end_date,'2026-11-02');
 assert.equal(simpleTimeRiver(rows,'period').items.length,1);
});
test('Trace mode selects an existing map type and nearest known real coordinates',()=>{
 const maps=[{trace_type:'path',uid:'P0000001'},{trace_type:'trace',uid:'T0000001'}];
 assert.equal(traceHomeMapChoices(maps,'path').length,1);
 assert.equal(traceHomeMapChoices(maps,'trace')[0].uid,'T0000001');
 assert.deepEqual(traceHomeMapChoices(maps,'anchor'),[]);
 const anchors=[{uid:'A1234567',longitude:121.5,latitude:25},
  {uid:'B1234567',longitude:121.51,latitude:25},
  {uid:'C1234567',longitude:122.5,latitude:25}];
 assert.deepEqual(nearestTracePlaceIds(['A1234567','C1234567','B1234567'],anchors,anchors[0]),
  ['A1234567','B1234567','C1234567']);
});

test('each feature consumes the same OAuth setting and applies all of its controls',()=>{
 const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
 const hook=read('app/loc/use-loc-feature-settings.js');
 assert.ok(hook.includes('useLocUser()'));
 assert.ok(hook.includes('LOC_USER_DEFAULTS[feature]'));
 const culture=read('app/modular/features/Culture.jsx');
 for(const token of ["useLocFeatureSettings('culture')",
 'simpleTimeRiver(timelineItems,userSettings.time)',
 "cultureDensityByUnit(classificationBuckets,userActive?userSettings.unit:'day')",
 "userSettings.display==='keywords'","userSettings.sort"])
   assert.ok(culture.includes(token),'Culture missing '+token);
 const statics=read('app/modular/features/Statistics.jsx');
 for(const token of ["useLocFeatureSettings('statics')",
 'rankingType:userSettings.display','userActive?userSettings.unit:deviceTimeUnit',
 "defaultSort={userActive?userSettings.sort:'desc'}"])
   assert.ok(statics.includes(token),'Statistics missing '+token);
 const trace=read('app/modular/features/Trace.jsx');
 for(const token of ["useLocFeatureSettings('trace')",
 'traceHomeMapChoices(allMapChoices,userSettings.display)',
 "timeMode={userActive?userSettings.time:'none'}",
 "defaultSort={userActive?userSettings.sort:'desc'}"])
   assert.ok(trace.includes(token),'Trace missing '+token);
 const traceWorks=read('app/modular/features/trace/TracePlaceResults.jsx');
 assert.ok(traceWorks.includes('nearestTracePlaceIds(placeIds,anchors,place)'));
 assert.ok(traceWorks.includes("timeMode!=='none'"));
 assert.ok(traceWorks.includes('selectScopeCultureData(targetScope)'));
 const search=read('app/modular/features/Search.jsx');
 assert.ok(search.includes("useLocFeatureSettings('search')"));
 assert.ok(search.includes("searchField:!managementMode&&userActive?userSettings.field:''"));
 assert.ok(search.includes("userActive?userSettings.sort:'desc'"));
 const providers=read('app/loc/galaxy-query.js');
 assert.ok(providers.includes("if(searchField==='title')return [titleExact,title]"));
 assert.ok(providers.includes("if(searchField==='content')return [contentExact,content]"));
});
test('Trace UID sorting is case-sensitive and supports eight-character identity',()=>{
 const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
 const trace=read('app/modular/features/trace/trace-panel-filters.mjs');
 assert.ok(trace.includes(".map(id=>String(id||'').trim())"));
 const time=read('app/modular/features/trace/TracePlaceResults.jsx');
 assert.ok(time.includes('const timeLabelForRow=row=>'));
 assert.ok(time.includes("const day=String(row.date||row.createtime||'').slice(0,10)"));
});
