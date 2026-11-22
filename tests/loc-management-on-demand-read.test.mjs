import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildEraRiver} from '../app/loc/culture/time-trace-river.mjs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('keyword management reads only authored Item words; no Pattern posting read',()=>{
  const source=read('app/loc/keywords/ui/KeywordLibraryPanel.jsx');
  const load=source.slice(source.indexOf('  const load=useCallback('),
    source.indexOf('  useEffect(()=>{load();},[load]);'));
  assert.match(load,/\.in\('type',\['category','class','group','item'\]\)/);
  assert.doesNotMatch(load,/\.in\('type',\[[^\]]*'pattern'/);
  assert.match(load,/\.order\('uid',\{ascending:true\}\)/);
  assert.doesNotMatch(source,/\.eq\('type','pattern'\)/);
  assert.doesNotMatch(source,/setPatternRead|selectedPatternRefKey|pattern_index_version/);
  // Item words come directly from attr.keyword, not a second query.
  assert.match(source,/row\.attr\?\.\[row\.type==='item'\?'keyword':'uid'\]/);
});

test('time editor can start its authorized read without a second public river',()=>{
  const culture=read('app/modular/features/Culture.jsx');
  assert.match(culture,/const scopeData=query\.data\?\.scope\|\|\(isTimeEditingView&&!isAggregateScope/);
  assert.match(culture,/defaultScopeData\(scopeId\)/);
  const editor=read('app/modular/features/CultureTimelineEditor.jsx');
  const query=read('app/loc/culture/query.js');
  assert.match(culture,/selectScopeCultureManagementData\(scopeId,\{signal\}\)/);
  assert.match(culture,/timeRecords=\{query\.data\?\.editorRows\|\|null\}/);
  assert.match(query,/const editorRows=await readManagedTimeRecords\(scope\.time,\{signal\}\)/);
  assert.match(query,/const parts=cultureParts\(editorRows,scope\.id\)/);
  assert.match(editor,/const all=Array\.isArray\(timeRecords\)\?timeRecords:\[\]/);
  assert.doesNotMatch(editor,/selectRows\(|readCompleteTimeRecords|useAsyncResource/);
  assert.match(editor,/transactionWrites\(plan\.operations\)/);
});

test('management TimeRiver uses complete historical bounds rather than a fixed year',()=>{
  const culture=read('app/modular/features/Culture.jsx');
  assert.match(culture,/const editorRiverWindow=structureDateBounds/);
  assert.match(culture,/windowStart=\{editorRiverWindow\.start\}/);
  assert.match(culture,/windowEnd=\{editorRiverWindow\.end\}/);
  assert.doesNotMatch(culture,/editorRiverYearWindow/);
});
test('management Era lanes retain all dated anchors and unclassified dates',()=>{
  const scope='lo3rwang';
  const dates=[
    {uid:'AAAA0001',entry_type:'anchor',scope_id:scope,title:'Old',start_date:'2012-01-01'},
    {uid:'AAAA0002',entry_type:'anchor',scope_id:scope,title:'Recent',start_date:'2020-02-02'},
    {uid:'AAAA0003',entry_type:'anchor',scope_id:scope,title:'Outside',start_date:'2026-11-22'}
  ];
  const entries=[
    {uid:'ERAA0001',entry_type:'era',scope_id:scope,title:'First era',
      anchor_ids:['PERA0001'],
      ranges:[{start_date:'2010-01-01',end_date:'2023-12-31'}]},
    {uid:'PERA0001',entry_type:'period',scope_id:scope,title:'First period',
      ranges:[{start_date:'2010-01-01',end_date:'2023-12-31'}]},
    ...dates
  ];
  const group='trace:'+scope+':ERAA0001';
  const river=buildEraRiver(entries,[],{editorOnly:true,scopeId:scope});
  assert.ok(river.groups.some(item=>item.id===group));
  assert.deepEqual(river.items.filter(item=>item.entry_type==='anchor')
    .map(item=>item.uid).sort(),dates.map(item=>item.uid).sort());
  assert.equal(river.items.find(item=>item.uid==='AAAA0003').group_key,
    'time-undefined:'+scope);
  const expanded=buildEraRiver(entries,[group],{editorOnly:true,scopeId:scope});
  assert.ok(expanded.groups.some(item=>item.id===group+':period:PERA0001'));
});

test('time management route mounts its own view even if Edit Dock was remounted',()=>{
  const src=read('app/modular/features/Culture.jsx');
  assert.match(src,/const onTimeManageRoute=pathname\.endsWith\('\/culture\/manage'\)/);
  assert.match(src,/const isTimeEditingView=onTimeManageRoute\|\|/);
  assert.match(src,/editorAuthorized=Boolean\(account\.user&&account\.canLocAccessSync/);
});
