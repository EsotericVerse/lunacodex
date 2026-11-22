import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildEraRiver} from '../app/loc/culture/time-trace-river.mjs';
import {traceRouteHierarchy} from '../app/modular/features/trace/trace-route-hierarchy.mjs';
import {touchEditorSession,editorSessionStatus,saveEditorManagement,readEditorManagement,
  clearEditorManagement,clearEditorSession} from '../app/loc/auth/edit-session-ttl.mjs';

const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('BlockNote abandons asynchronous HTML work and releases its ProseMirror editor on exit',()=>{
  const editor=source('app/loc/editor/BlockNoteEditorClient.jsx');
  assert.match(editor,/mountedRef\.current=false/);
  assert.match(editor,/htmlEmitVersion\.current\+\+/);
  assert.match(editor,/epoch===editorEpoch\.current/);
  assert.match(editor,/tiptap\.destroy\?\.\(\)/);
  const drafts=source('app/loc/blocks/ScopeBlockDraftList.jsx');
  assert.doesNotMatch(drafts,/localStorage|sessionStorage|indexedDB/);
});

test('management section change abandons the old editors and transient reads',()=>{
  const sections=source('app/modular/ManagementSectionNav.jsx');
  const dock=source('app/modular/edit-dock.jsx');
  assert.match(sections,/prepareTransientResourceAction\('management'\)/);
  assert.match(dock,/const switchSection=useCallback/);
  assert.match(dock,/clearEditor\(\);setNotice\(''\)/);
  assert.match(dock,/registeredEditors\.current\.clear\(\)/);
});

test('homepage six-key hard navigation does not clear live page or editor Session',()=>{
  const dock=source('app/modular/edit-dock.jsx');
  const resources=source('packages/zenstack/client-queries.js');
  // Hard navigation unloads its document naturally. An eager global flush
  // erases the live homepage if the next HTML entrypoint is slow to load.
  assert.match(dock,/const documentExit=url\.origin/);
  assert.match(dock,/if\(documentExit\)\{\s*window\.location\.assign\(url\.href\)/);
  assert.match(dock,/window\.location\.assign\(destination\.href\)/);
  const navigate=dock.slice(dock.indexOf('const navigate='),dock.indexOf('const complete='));
  assert.doesNotMatch(navigate,/releaseTransientPageResources\(|transactionWrites\(|clearEditorSession\(/);
  const discard=dock.slice(dock.indexOf('const discard='),dock.indexOf('const switchTo='));
  assert.doesNotMatch(discard,/releaseTransientPageResources\(|transactionWrites\(|clearEditorSession\(/);
  assert.match(resources,/export function releaseTransientPageResources\(\)/);
  assert.match(resources,/cancelTransientReads\(\);\s*abortInflight\(\);/);
  assert.match(resources,/if\(retryBootstrap\.size\)queueMicrotask/,
    'SPA route cleanups must still revive observed shared Bootstrap');
});

test('transient management verification failure removes grants but preserves the session clock',()=>{
  const values=new Map(),storage={
    getItem:key=>values.get(key)||null,
    setItem:(key,val)=>values.set(key,val),
    removeItem:key=>values.delete(key)
  };
  const now=1700000000000;
  assert.equal(touchEditorSession(storage,now),true);
  assert.equal(saveEditorManagement(storage,{user:{id:'user',email:'user@example.org'},
    roles:[],grants:[]},now+500),true);
  const before=editorSessionStatus(storage,now+1000);
  assert.ok(readEditorManagement(storage,now+1000));
  clearEditorManagement(storage);
  assert.deepEqual(editorSessionStatus(storage,now+1000),before);
  assert.equal(readEditorManagement(storage,now+1000),null);
  assert.equal(touchEditorSession(storage,now+1000),true);
  const account=source('app/loc/auth/use-account.js');
  assert.match(account,/clearEditorManagement\(window\.sessionStorage\)/);
  assert.match(account,/if\(error\?\.status===401\)\{\s*if\(typeof window!==['"]undefined['"]\)clearEditorSession/);
  clearEditorSession(storage);
  assert.equal(storage.getItem('loc-editor-session-v1'),null);
});

test('Culture orders Era > Period > Date anchors, then the next Era',()=>{
  const scope='lo3rwang',a='AAAA0001',b='BBBB0001';
  const records=[
    {uid:a,entry_type:'era',scope_id:scope,title:'Era 1',anchor_ids:['PPPP0001'],
      ranges:[{start_date:'2000-01-01',end_date:'2010-12-31'}]},
    {uid:'PPPP0001',entry_type:'period',scope_id:scope,title:'Period 1',
      ranges:[{start_date:'2001-01-01',end_date:'2009-12-31'}]},
    {uid:'DDDD0001',entry_type:'anchor',scope_id:scope,title:'Date 1',
      start_date:'2005-01-01'},
    {uid:b,entry_type:'era',scope_id:scope,title:'Era 2',anchor_ids:[],
      ranges:[{start_date:'2011-01-01',end_date:'2020-12-31'}]},
    {uid:'DDDD0002',entry_type:'anchor',scope_id:scope,title:'Unassigned',
      start_date:'2024-01-01'}
  ];
  const first='trace:'+scope+':'+a;
  const second='trace:'+scope+':'+b;
  const periodId=first+':period:PPPP0001';
  for(const editorOnly of [true,false]){
    const expanded=editorOnly?[first,periodId,second]:[first,second];
    const river=buildEraRiver(records,expanded,{editorOnly,scopeId:scope});
    const ordered=river.groups.map(row=>row.id);
    const era=ordered.indexOf(first);
    const period=ordered.findIndex(id=>id.includes('PPPP0001'));
    const date=ordered.findIndex(id=>id.includes('anchors:')||
      id.endsWith(':anchors')||id.endsWith(':dates'));
    const nextEra=ordered.indexOf(second);
    assert.ok(era>=0&&era<period&&period<date&&date<nextEra,
      'must sort Era, its Period, its Date anchor group, then next Era');
    assert.ok(river.groups.some(row=>row.id==='time-undefined:'+scope));
  }
});

test('Trace selection is authored parent-child relation, not flattened mixed routes',()=>{
  const scope='lo3rwang',trace={uid:'TTTT0001',source_scope:scope,
    trace_type:'trace',title:'Trace',route_list:{routes:['PPPP0001']}};
  const path={uid:'PPPP0001',source_scope:scope,trace_type:'path',title:'Path'};
  const hierarchy=traceRouteHierarchy([path,trace]);
  assert.equal(hierarchy.groups.length,1);
  assert.deepEqual(hierarchy.groups[0].paths,[path]);
  assert.equal(hierarchy.orphans.length,0);
  const preview=source('app/modular/features/LocTracePreview.jsx');
  assert.match(preview,/aria-label="痕跡圖選擇"/);
  assert.match(preview,/aria-label="所屬路徑圖選擇"/);
});
