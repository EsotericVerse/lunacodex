import test from 'node:test';
import assert from 'node:assert/strict';
import {buildEraRiver,nextEditorEraExpansion} from '../app/loc/culture/time-trace-river.mjs';

const scopeId='scope-a';
const eraId='trace:scope-a:era-a';
const periodId=eraId+':period:period-a';
const source=[
  {entry_type:'era',scope_id:scopeId,uid:'era-a',title:'Era A',anchor_ids:['period-a'],
    ranges:[{start_date:'2025-01-01',end_date:'2025-12-31'}]},
  {entry_type:'period',scope_id:scopeId,uid:'period-a',title:'Period A',
    ranges:[{start_date:'2025-03-01',end_date:'2025-05-31'}]},
  {entry_type:'lucus',scope_id:scopeId,uid:'anchor-a',title:'Anchor A',start_date:'2025-03-10'},
  {entry_type:'lucus',scope_id:scopeId,uid:'anchor-b',title:'Anchor B',start_date:'2025-05-20'},
  {entry_type:'lucus',scope_id:scopeId,uid:'anchor-c',title:'Unassigned',start_date:'2026-02-01'},
];

test('public Culture time hierarchy opens Era, Period, then date anchors on demand',()=>{
  const collapsed=buildEraRiver(source,[],{editorOnly:true,scopeId});
  assert.deepEqual(collapsed.groups.map(group=>group.id),[
    eraId,'time-undefined:'+scopeId
  ]);
  assert.deepEqual(collapsed.items.map(item=>item.entry_type),['era']);

  const eraExpanded=nextEditorEraExpansion([],eraId);
  assert.deepEqual(eraExpanded,[eraId]);
  const withPeriods=buildEraRiver(source,eraExpanded,{editorOnly:true,scopeId});
  assert.ok(withPeriods.groups.some(group=>group.id===periodId));
  assert.equal(withPeriods.items.some(item=>item.entry_type==='lucus'),false);

  const periodExpanded=nextEditorEraExpansion(eraExpanded,periodId);
  assert.deepEqual(periodExpanded,[eraId,periodId]);
  const withDates=buildEraRiver(source,periodExpanded,{editorOnly:true,scopeId});
  assert.ok(withDates.groups.some(group=>group.id===periodId+':dates'));
  assert.deepEqual(withDates.items.filter(item=>item.entry_type==='lucus').map(item=>item.uid),[
    'anchor-a','anchor-b'
  ]);
});

test('opening an Era replaces the previous Era branch and unassigned anchors stay separate',()=>{
  const secondEraId='trace:scope-a:era-b';
  assert.deepEqual(nextEditorEraExpansion([eraId,periodId],secondEraId),[secondEraId]);
  const undefinedId='time-undefined:'+scopeId;
  const opened=nextEditorEraExpansion([],undefinedId);
  const river=buildEraRiver(source,opened,{editorOnly:true,scopeId});
  assert.deepEqual(river.items.filter(item=>item.entry_type==='lucus').map(item=>item.uid),[
    'anchor-c'
  ]);
});
