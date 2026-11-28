import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
  buildLocEraIndex,buildLocEraRiver,locEraWindows,mergeLocCultureDensityRows
} from '../app/loc/culture/loc-group-river.mjs';

const rows=[
  {scope_id:'alpha',uid:'OLDERA01',type:'era',title:'早期時代',attr:{period:['OLDPER01']}},
  {scope_id:'alpha',uid:'OLDPER01',type:'period',title:'早期期間',attr:{uid:['OLDATE01','OLDATE02']}},
  {scope_id:'alpha',uid:'OLDATE01',type:'date',title:'早期起點',attr:{date:'2001-01-01'}},
  {scope_id:'alpha',uid:'OLDATE02',type:'date',title:'早期終點',attr:{date:'2002-12-31'}},
  {scope_id:'alpha',uid:'NEWERA01',type:'era',title:'近期時代',attr:{period:['NEWPER01']}},
  {scope_id:'alpha',uid:'NEWPER01',type:'period',title:'近期期間',attr:{uid:['NEWATE01','NEWATE02']}},
  {scope_id:'alpha',uid:'NEWATE01',type:'date',title:'近期起點',attr:{date:'2025-01-01'}},
  {scope_id:'alpha',uid:'NEWATE02',type:'date',title:'近期終點',attr:{date:'2026-12-31'}},
  {scope_id:'beta',uid:'BETERA01',type:'era',title:'另一 Scope 時代',attr:{period:['BETPER01']}},
  {scope_id:'beta',uid:'BETPER01',type:'period',title:'另一 Scope 期間',attr:{uid:['BETDAT01','BETDAT02']}},
  {scope_id:'beta',uid:'BETDAT01',type:'date',title:'另一 Scope 起點',attr:{date:'2024-01-01'}},
  {scope_id:'beta',uid:'BETDAT02',type:'date',title:'另一 Scope 終點',attr:{date:'2024-12-31'}},
  {scope_id:'beta',uid:'BETDAT03',type:'date',title:'另一 Scope 同期定錨',attr:{date:'2001-06-01'}}
];

test('LOC Era index keeps historical Eras even when their Date anchors are outside the current year',()=>{
  const eras=buildLocEraIndex(rows);
  assert.deepEqual(eras.map(row=>row.title),['近期時代','另一 Scope 時代','早期時代']);
  assert.equal(eras.find(row=>row.title==='早期時代').start_date,'2001-01-01');
  assert.equal(eras.find(row=>row.title==='早期時代').end_date,'2002-12-31');
});

test('one selected Era renders its Period and aligns in-window Date anchors from all Scopes',()=>{
  const eras=buildLocEraIndex(rows);
  const selected=eras.find(row=>row.title==='早期時代');
  const windows=locEraWindows(selected);
  const river=buildLocEraRiver(rows,selected.key,windows);
  assert.equal(river.era.title,'早期時代');
  assert.ok(river.groups.some(group=>group.label==='早期期間'));
  assert.deepEqual(river.items.filter(row=>row.entry_type==='lucus')
    .map(row=>row.start_date).sort(),['2001-01-01','2001-06-01','2002-12-31']);
  assert.equal(river.items.some(row=>row.title==='近期時代'),false);
  assert.ok(river.items.some(row=>row.scope_id==='beta'&&row.start_date==='2001-06-01'));
  assert.ok(river.groups.some(group=>group.label==='beta · 時間定錨'));
});

test('initial one-year window filters Date anchors without deleting the historical Era index',()=>{
  const eras=buildLocEraIndex(rows);
  const recent=eras.find(row=>row.title==='近期時代');
  const river=buildLocEraRiver(rows,recent.key,[{startDate:'2026-01-01',endDate:'2026-12-31'}]);
  assert.equal(river.era.title,'近期時代');
  assert.deepEqual(river.items.filter(row=>row.entry_type==='lucus')
    .map(row=>row.start_date),['2026-12-31']);
  assert.equal(eras.length,3);
});

test('LOC density aggregation merges same-day sources across member Scopes',()=>{
  assert.deepEqual(mergeLocCultureDensityRows([
    {scope_id:'alpha',day:'2026-01-01',site:'Facebook',item_count:3},
    {scope_id:'beta',day:'2026-01-01',site:'Facebook',item_count:4},
    {scope_id:'alpha',day:'2026-01-02',site:'Threads',item_count:2}
  ]),[
    {day:'2026-01-01',site:'Facebook',item_count:7},
    {day:'2026-01-02',site:'Threads',item_count:2}
  ]);
});

test('LOC Group Culture reads use date-window predicates and one SQL source aggregate',async()=>{
  const action=await readFile(new URL('../app/loc/actions/culture/queries.mjs',import.meta.url),'utf8');
  const time=action.slice(action.indexOf('export async function queryLocCultureTimeRiver'),
    action.indexOf('export async function queryLocCultureDensity'));
  const density=action.slice(action.indexOf('export async function queryLocCultureDensity'),
    action.indexOf('export async function queryCulture(args'));
  assert.match(time,/t\.type in \('era','period'\)/);
  assert.match(time,/t\.uid in \(\$\{endpoints\}\)/);
  assert.match(time,/timeDatePredicate\(port\.engine,windows,'t'\)/);
  assert.match(density,/g\.date is not null and \$\{datePredicate\}/);
  assert.match(density,/group by scope_id,day,site/);
  assert.doesNotMatch(density,/mapBounded|selectScopeDailyCounts/);
});

test('LOC public Culture uses the merged double river and era navigation without chart remount',async()=>{
  const reader=await readFile(new URL('../app/loc/views/CulturePublicReader.jsx',import.meta.url),'utf8');
  const locReader=await readFile(new URL('../app/loc/views/LocGroupCultureReader.jsx',import.meta.url),'utf8');
  const timeline=await readFile(new URL('../app/modular/modules/culture-timeline/CultureTimeline.jsx',import.meta.url),'utf8');
  assert.match(reader,/scopeId==='loc'\?\<LocGroupCultureReader\/>/);
  assert.match(locReader,/heightVariant='double'/);
  assert.match(locReader,/onEraNavigate=/);
  assert.match(locReader,/Promise\.all\(\[\s*queryLocCultureTimeRiver/);
  assert.match(timeline,/heightVariant==='double'\?null:windowStart/);
  assert.match(timeline,/Culture Era viewport update failed/);
});
