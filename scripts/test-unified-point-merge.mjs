import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {selectPointMergeSources} from '../app/loc/trace-point-merge-selection.mjs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const points=[
  {uid:'Aa10Bb20',title:'主要'},
  {uid:'Cc30Dd40',title:'來源一'},
  {uid:'Ee50Ff60',title:'來源二'},
  {uid:'Gg70Hh80',title:'來源三'}
];

test('primary UID is excluded even when bulk select accidentally includes it',()=>{
  assert.deepEqual(selectPointMergeSources(points,'Aa10Bb20',
    ['Aa10Bb20','Cc30Dd40','Cc30Dd40','Ee50Ff60']),
  ['Cc30Dd40','Ee50Ff60']);
  assert.deepEqual(selectPointMergeSources(points,'Aa10Bb20',['aa10bb20']),[],
    'Base62 UID equality must remain case-sensitive');
  assert.deepEqual(selectPointMergeSources(points,'Aa10Bb20',
    ['Cc30Dd40'],{visibilityPending:true}),[],
    'bulk visibility is a distinct operation, never an implicit merge');
  assert.deepEqual(selectPointMergeSources(points,'',['Cc30Dd40']),[]);
  assert.deepEqual(selectPointMergeSources(points,'Aa10Bb20',
    ['Cc30Dd40','not-in-current-scope']),['Cc30Dd40']);
});

test('spatial management saves through the existing dock with visible selection and no extra merge page',()=>{
  const page=read('app/loc/TraceManagement.jsx');
  const workspace=read('app/loc/PlaceManagement.jsx');
  assert.match(page,/const mergeUids=useMemo\(\(\)=>selectPointMergeSources\(/);
  assert.match(page,/const sources=\[\.\.\.mergeUids\]/);
  assert.match(page,/mergedCount=await mergeTraceAnchorPoints\(/);
  assert.match(page,/keepUid:editingUid,removeUids:sources/);
  assert.match(page,/setBulkUids\(ids=>ids\.filter\(uid=>!sources\.includes\(uid\)\)\)/);
  assert.match(page,/const refreshed=await reload\(\)/);
  assert.match(page,/disabled=\{busy\|\|bulkBusy\|\|row\.uid===editingUid\}/);
  assert.match(page,/useEditDockForm\(\{save,isDirty:/);
  assert.match(page,/setBulkUids\(\[\]\);\s*setPendingVisibility\(null\);/);
  assert.match(workspace,/mode="anchor"/);
  assert.doesNotMatch(workspace,/value:'merge'|mode="merge"/);
});

test('lo3rwang point manager uses physical _anchor with point and typed attrs',()=>{
  const data=read('app/modular/features/trace/trace-data.js');
  assert.match(data,/const physicalPoint=id=>dbAuthClient\.schema\('silver'\)\.from\(id\+'_anchor'\)/);
  assert.match(data,/const ANCHOR_COLUMNS='uid,type,title,description,invisible,attr'/);
  assert.match(data,/isUnified\(id\)\?id\+'_anchor':id\+'_trace'/);
  assert.match(data,/\.eq\('type','point'\)/);
  assert.match(data,/attr\.longitude=coords\[0\]/);
  assert.match(data,/attr\.latitude=coords\[1\]/);
  assert.match(data,/attr\.location=location/);
  assert.match(data,/type:'point'/);
  assert.match(data,/\.rpc\('merge_scope_trace_place_names'/);
  assert.match(data,/p_scope_id:id,p_keep_uid:primary,p_remove_uids:sources/);
  assert.match(data,/merged_count/);
  assert.match(data,/point:anchor_list\.flat\(\),path:route_list/);
  assert.match(data,/point:type==='trace'\?anchor_list\.flat\(\):anchor_list/);
  assert.doesNotMatch(data,/delete\(\)\.in\('uid',sources\)/);
});

test('aliases use point attr.location and edit controls are apart from management links',()=>{
  const organizer=read('app/loc/TraceOrganizer.jsx');
  const shell=read('app/AppShell.jsx');
  const css=read('app/styles/bottom-navigation.css');
  assert.match(organizer,/unified\?'_anchor':'_place'/);
  assert.match(organizer,/\.rpc\('save_scope_trace_place_names'/);
  assert.match(organizer,/\.from\(scopeId\+'_anchor'\)\.select\('attr'\)/);
  assert.match(shell,/<nav className="scope-feature-dock"/);
  assert.match(shell, /editingDockVisible\?editTabs\.map/);
  assert.match(css,/\.scope-feature-dock/);
  assert.match(css,/grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
  assert.match(shell,/const editTabs=\[/);
});


test('Fixed Edit Dock Save protects spatial UID merge and preserves visible RPC errors',()=>{
  const form=read('app/loc/TraceManagement.jsx');
  const dock=read('app/modular/edit-dock.jsx');
  assert.match(form,/const save=async\(\{switching=false\}=\{\}\)=>\{/);
  assert.match(form,/sources\.length&&!switching&&!window\.confirm/);
  assert.match(form,/visibility&&!switching&&!window\.confirm/);
  assert.match(form,/mergedCount=await mergeTraceAnchorPoints/);
  assert.match(form,/setBulkUids\(ids=>ids\.filter\(uid=>!sources\.includes\(uid\)\)\)/);
  assert.match(form,/throw new Error\(message,\{cause:e\}\)/,
    'server and permission errors must reach the visible switch dialog');
  assert.match(form,/isDestructive:\(\)=>mergeUids\.length>0\|\|Boolean\(pendingVisibility\)/);
  assert.match(dock,/isDestructive:actions\.isDestructive/);
  assert.match(dock,/editor\.isDirty\?\.\(\)&&editor\.isDestructive\?\.\(\)/);
  assert.match(dock,/請使用固定六鍵的「儲存」確認執行/);
  assert.doesNotMatch(dock,/儲存並切換|saveAndSwitch/);
  assert.match(dock,/saved!==true\)\{[\s\S]*?setNotice\('部分設定未儲存/);
});
